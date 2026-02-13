import { expect, it } from 'bun:test';
import { extractTimelinePageFromResponse, queryProfileTimelinePage } from '@/runtime/query/profileTimeline';

it('should extract posts and next cursor from feed edges payload', () => {
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

it('should handle streamed payload arrays (node chunks + page_info chunk)', () => {
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

it('should prefer a later page_info candidate with next cursor in streamed payloads', () => {
    const streamedPayload = [
        {
            data: {
                page_info: {
                    end_cursor: null,
                    has_next_page: false,
                },
            },
        },
        {
            data: {
                node: {
                    timeline_list_feed_units: {
                        edges: [
                            {
                                node: {
                                    comet_sections: {
                                        content: {
                                            story: {
                                                message: { text: 'post with newer cursor chunk' },
                                            },
                                        },
                                    },
                                    id: 'story-2',
                                    post_id: 'post-2',
                                },
                            },
                        ],
                        page_info: {
                            end_cursor: 'cursor-newer',
                            has_next_page: true,
                        },
                    },
                },
            },
        },
    ];

    const page = extractTimelinePageFromResponse(streamedPayload);
    expect(page.nextCursor).toBe('cursor-newer');
    expect(page.posts.map((post) => post.post_id)).toEqual(['post-2']);
});

it('should resolve next cursor from deep page_info location when path-based lookup misses', () => {
    const streamedPayload = [
        {
            data: {
                node: {
                    timeline_list_feed_units: {
                        edges: [
                            {
                                node: {
                                    comet_sections: {
                                        content: {
                                            story: {
                                                message: { text: 'deep cursor post' },
                                            },
                                        },
                                    },
                                    id: 'story-deep',
                                    post_id: 'post-deep',
                                },
                            },
                        ],
                    },
                },
            },
        },
        {
            data: {
                viewer: {
                    pagination: {
                        page_info: {
                            end_cursor: 'cursor-deep',
                            has_next_page: true,
                        },
                    },
                },
            },
        },
    ];

    const page = extractTimelinePageFromResponse(streamedPayload);
    expect(page.nextCursor).toBe('cursor-deep');
    expect(page.posts.map((post) => post.post_id)).toEqual(['post-deep']);
});

it('should send calibrated query name and cursor override', async () => {
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

it('should forward abort signal to graphql request input', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const controller = new AbortController();
    await queryProfileTimelinePage(
        {
            request: async (input) => {
                requests.push(input as Record<string, unknown>);
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
        { cursor: null, signal: controller.signal },
    );

    expect(requests[0]?.signal).toBe(controller.signal);
});

it('should throw when GraphQL errors are returned without page data', async () => {
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

it('should handle null payload and invalid timeline nodes safely', () => {
    expect(extractTimelinePageFromResponse(null)).toEqual({ nextCursor: null, posts: [] });

    const response = {
        data: {
            node: {
                timeline_list_feed_units: {
                    edges: [
                        { node: 'not-an-object' },
                        { node: { comet_sections: {} } },
                    ],
                },
            },
        },
    };
    const page = extractTimelinePageFromResponse(response);
    expect(page.posts).toEqual([]);
    expect(page.nextCursor).toBeNull();
});

it('should resolve creation_time from fallback metadata and normalize numeric strings', () => {
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
                                            message: {
                                                text: 'fallback time post',
                                            },
                                        },
                                    },
                                    context_layout: {
                                        story: {
                                            comet_sections: {
                                                metadata: [{ story: { creation_time: '1700000100' } }],
                                            },
                                        },
                                    },
                                },
                                id: 'story-x',
                                post_id: 'post-x',
                            },
                        },
                    ],
                    page_info: {
                        end_cursor: '',
                        has_next_page: true,
                    },
                },
            },
        },
    };
    const page = extractTimelinePageFromResponse(response);
    expect(page.posts[0]?.createdAt).toBe(1700000100);
    expect(page.nextCursor).toBeNull();
});

it('should ignore malformed GraphQL errors when message is missing', async () => {
    await expect(
        queryProfileTimelinePage(
            {
                request: async () => ({
                    errors: ['bad', { code: 'X' }],
                }),
            },
            { cursor: null },
        ),
    ).resolves.toEqual({ nextCursor: null, posts: [] });
});
