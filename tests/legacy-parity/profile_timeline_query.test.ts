import { expect, test } from "bun:test";
import {
  extractTimelinePageFromResponse,
  queryProfileTimelinePage
} from "../../src/runtime/query/profileTimeline";

test("timeline parser extracts posts and next cursor from feed edges payload", () => {
  const response = {
    data: {
      node: {
        timeline_list_feed_units: {
          page_info: {
            has_next_page: true,
            end_cursor: "cursor-2"
          },
          edges: [
            {
              node: {
                id: "story-1",
                post_id: "post-1",
                comet_sections: {
                  content: {
                    story: {
                      message: {
                        text: "first post"
                      },
                      attachments: [],
                      comet_sections: {
                        context_layout: {
                          story: {
                            comet_sections: {
                              metadata: [{ story: { creation_time: 1700000000 } }]
                            }
                          }
                        }
                      }
                    }
                  },
                  context_layout: {
                    story: {
                      comet_sections: {
                        actor_photo: {
                          story: {
                            actors: [
                              {
                                id: "author-1",
                                name: "Author One",
                                profile_url: "https://www.facebook.com/author.one"
                              }
                            ]
                          }
                        }
                      }
                    }
                  }
                }
              }
            },
            {
              node: {
                id: "story-2",
                post_id: "post-2",
                comet_sections: {
                  content: {
                    story: {
                      message: {
                        text: "second post"
                      },
                      attachments: [{ __typename: "Photo" }],
                      comet_sections: {
                        context_layout: {
                          story: {
                            comet_sections: {
                              metadata: [{ story: { creation_time: 1700000001 } }]
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          ]
        }
      }
    }
  };

  const page = extractTimelinePageFromResponse(response);
  expect(page.nextCursor).toBe("cursor-2");
  expect(page.posts.map((post) => post.post_id)).toEqual(["post-1", "post-2"]);
  expect(page.posts[0]?.content).toBe("first post");
  expect(page.posts[0]?.author).toEqual({
    id: "author-1",
    name: "Author One",
    profile: "https://www.facebook.com/author.one"
  });
});

test("timeline parser handles streamed payload arrays (node chunks + page_info chunk)", () => {
  const streamedPayload = [
    {
      data: {
        node: {
          post_id: "post-1",
          id: "story-1",
          comet_sections: {
            content: {
              story: {
                message: { text: "first streamed post" },
                attachments: []
              }
            },
            context_layout: {
              story: {
                comet_sections: {
                  metadata: [{ story: { creation_time: 1700000000 } }]
                }
              }
            }
          }
        }
      }
    },
    {
      data: {
        page_info: {
          has_next_page: true,
          end_cursor: "cursor-stream-2"
        }
      }
    }
  ];

  const page = extractTimelinePageFromResponse(streamedPayload);
  expect(page.nextCursor).toBe("cursor-stream-2");
  expect(page.posts.length).toBe(1);
  expect(page.posts[0]?.post_id).toBe("post-1");
});

test("timeline query sends calibrated query name and cursor override", async () => {
  const requests: Array<{
    queryName: string;
    variables?: Record<string, unknown>;
    responseMode?: "single" | "all";
  }> = [];
  const page = await queryProfileTimelinePage(
    {
      request: async (input) => {
        requests.push(input);
        return {
          data: {
            node: {
              timeline_list_feed_units: {
                page_info: { has_next_page: false, end_cursor: null },
                edges: []
              }
            }
          }
        };
      }
    },
    { cursor: "cursor-abc" }
  );

  expect(requests).toEqual([
    {
      queryName: "ProfileCometTimelineFeedRefetchQuery",
      variables: { cursor: "cursor-abc" },
      responseMode: "all"
    }
  ]);
  expect(page).toEqual({ nextCursor: null, posts: [] });
});

test("timeline query throws when GraphQL errors are returned without page data", async () => {
  await expect(
    queryProfileTimelinePage(
      {
        request: async () => ({
          errors: [
            {
              code: 1675004,
              message: "Rate limit exceeded"
            }
          ]
        })
      },
      { cursor: null }
    )
  ).rejects.toThrow("timeline query returned GraphQL errors");
});
