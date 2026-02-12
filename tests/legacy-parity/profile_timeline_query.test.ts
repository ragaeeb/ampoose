import { expect, test } from 'bun:test';
import { extractTimelinePageFromResponse, queryProfileTimelinePage } from '../../src/runtime/query/profileTimeline';

test('timeline parser extracts posts and next cursor from feed edges payload', () => {
    const response = {
        data: {
            node: {
                timeline_list_feed_units: {
                    edges: [
                        {
                            node: {
                                comet_sections: {
                                    content: {
                                        story: {
                                            attachments: [],
                                            comet_sections: {
                                                context_layout: {
                                                    story: {
                                                        comet_sections: {
                                                            metadata: [{ story: { creation_time: 1700000000 } }],
                                                        },
                                                    },
                                                },
                                            },
                                            message: {
                                                text: 'first post',
                                            },
                                        },
                                    },
                                    context_layout: {
                                        story: {
                                            comet_sections: {
                                                actor_photo: {
                                                    story: {
                                                        actors: [
                                                            {
                                                                id: 'author-1',
                                                                name: 'Author One',
                                                                profile_url: 'https://www.facebook.com/author.one',
                                                            },
                                                        ],
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                                id: 'story-1',
                                post_id: 'post-1',
                            },
                        },
                        {
                            node: {
                                comet_sections: {
                                    content: {
                                        story: {
                                            attachments: [{ __typename: 'Photo' }],
                                            comet_sections: {
                                                context_layout: {
                                                    story: {
                                                        comet_sections: {
                                                            metadata: [{ story: { creation_time: 1700000001 } }],
                                                        },
                                                    },
                                                },
                                            },
                                            message: {
                                                text: 'second post',
                                            },
                                        },
                                    },
                                },
                                id: 'story-2',
                                post_id: 'post-2',
                            },
                        },
                    ],
                    page_info: {
                        end_cursor: 'cursor-2',
                        has_next_page: true,
                    },
                },
            },
        },
    };

    const page = extractTimelinePageFromResponse(response);
    expect(page.nextCursor).toBe('cursor-2');
    expect(page.posts.map((post) => post.post_id)).toEqual(['post-1', 'post-2']);
    expect(page.posts[0]?.content).toBe('first post');
    expect(page.posts[0]?.author).toEqual({
        id: 'author-1',
        name: 'Author One',
        profile: 'https://www.facebook.com/author.one',
    });
});

test('timeline parser handles streamed payload arrays (node chunks + page_info chunk)', () => {
    const streamedPayload = [
        {
            data: {
                node: {
                    comet_sections: {
                        content: {
                            story: {
                                attachments: [],
                                message: { text: 'first streamed post' },
                            },
                        },
                        context_layout: {
                            story: {
                                comet_sections: {
                                    metadata: [{ story: { creation_time: 1700000000 } }],
                                },
                            },
                        },
                    },
                    id: 'story-1',
                    post_id: 'post-1',
                },
            },
        },
        {
            data: {
                page_info: {
                    end_cursor: 'cursor-stream-2',
                    has_next_page: true,
                },
            },
        },
    ];

    const page = extractTimelinePageFromResponse(streamedPayload);
    expect(page.nextCursor).toBe('cursor-stream-2');
    expect(page.posts.length).toBe(1);
    expect(page.posts[0]?.post_id).toBe('post-1');
});

test('timeline query sends calibrated query name and cursor override', async () => {
    const requests: Array<{
        queryName: string;
        variables?: Record<string, unknown>;
        responseMode?: 'single' | 'all';
    }> = [];
    const page = await queryProfileTimelinePage(
        {
            request: async (input) => {
                requests.push(input);
                return {
                    data: {
                        node: {
                            timeline_list_feed_units: {
                                edges: [],
                                page_info: { end_cursor: null, has_next_page: false },
                            },
                        },
                    },
                };
            },
        },
        { cursor: 'cursor-abc' },
    );

    expect(requests).toEqual([
        {
            queryName: 'ProfileCometTimelineFeedRefetchQuery',
            responseMode: 'all',
            variables: { cursor: 'cursor-abc' },
        },
    ]);
    expect(page).toEqual({ nextCursor: null, posts: [] });
});

test('timeline query throws when GraphQL errors are returned without page data', async () => {
    await expect(
        queryProfileTimelinePage(
            {
                request: async () => ({
                    errors: [
                        {
                            code: 1675004,
                            message: 'Rate limit exceeded',
                        },
                    ],
                }),
            },
            { cursor: null },
        ),
    ).rejects.toThrow('timeline query returned GraphQL errors');
});
