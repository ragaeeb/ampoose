import { expect, mock, test } from "bun:test";
import {
  buildGraphqlArtifact,
  getMissingRequiredQueries,
  normalizeGraphqlArtifact
} from "../../src/domain/calibration/artifact";
import { createGraphqlClient } from "../../src/domain/graphql/client";

test("calibration contract: missing/partial/valid", () => {
  const missing = normalizeGraphqlArtifact(null);
  expect(missing).toBeNull();

  const partial = normalizeGraphqlArtifact({
    schemaVersion: 1,
    updatedAt: "2026-02-11T00:00:00.000Z",
    entries: {
      ProfileCometTimelineFeedRefetchQuery: {
        queryName: "ProfileCometTimelineFeedRefetchQuery",
        docId: "123",
        variables: { id: "100026362418520" },
        preload: []
      }
    }
  });

  expect(partial).not.toBeNull();
  expect(getMissingRequiredQueries(partial)).toEqual([]);

  const valid = buildGraphqlArtifact({
    ProfileCometTimelineFeedRefetchQuery: {
      queryName: "ProfileCometTimelineFeedRefetchQuery",
      docId: "123",
      variables: { scale: 1, id: "100026362418520" },
      preload: []
    },
    CometSinglePostDialogContentQuery: {
      queryName: "CometSinglePostDialogContentQuery",
      docId: "456",
      variables: { scale: 1 },
      preload: []
    }
  });

  expect(getMissingRequiredQueries(valid)).toEqual([]);
});

test("calibration contract: timeline entry must include profile id", () => {
  const partialMissingId = normalizeGraphqlArtifact({
    schemaVersion: 1,
    updatedAt: "2026-02-11T00:00:00.000Z",
    entries: {
      ProfileCometTimelineFeedRefetchQuery: {
        queryName: "ProfileCometTimelineFeedRefetchQuery",
        docId: "123",
        variables: {},
        preload: []
      }
    }
  });

  expect(partialMissingId).not.toBeNull();
  expect(getMissingRequiredQueries(partialMissingId)).toEqual(["ProfileCometTimelineFeedRefetchQuery"]);
});

test("graphql client fails fast when calibration is missing", async () => {
  const client = createGraphqlClient({
    loadArtifact: async () => null,
    fetchImpl: mock(async () => new Response("{}")) as unknown as typeof fetch
  });

  await expect(
    client.request({
      queryName: "ProfileCometTimelineFeedRefetchQuery"
    })
  ).rejects.toThrow("Calibration missing required entries");
});

test("graphql client uses local calibration entries and does not depend on graphql-info host", async () => {
  const calls: Array<{ url: string; body: string }> = [];

  const client = createGraphqlClient({
    loadArtifact: async () =>
      buildGraphqlArtifact({
        ProfileCometTimelineFeedRefetchQuery: {
          queryName: "ProfileCometTimelineFeedRefetchQuery",
          docId: "123",
          variables: { scale: 2, id: "100026362418520" },
          requestParams: {
            __a: "1"
          },
          preload: []
        },
        CometSinglePostDialogContentQuery: {
          queryName: "CometSinglePostDialogContentQuery",
          docId: "456",
          variables: { scale: 2 },
          preload: []
        }
      }),
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const body = init?.body;
      calls.push({
        url,
        body: body instanceof URLSearchParams ? body.toString() : String(body ?? "")
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch
  });

  const result = await client.request<{ ok: boolean }>({
    queryName: "ProfileCometTimelineFeedRefetchQuery",
    variables: { cursor: "abc" },
    endpoint: "/api/graphql/"
  });

  expect(result.ok).toBe(true);
  expect(calls.length).toBe(1);
  expect(calls[0]?.url).toBe("/api/graphql/");
  expect(calls[0]?.body.includes("doc_id=123")).toBe(true);
  expect(calls[0]?.body.includes("__a=1")).toBe(true);
});

test("graphql client parses anti-hijacking prefixed JSON responses", async () => {
  const client = createGraphqlClient({
    loadArtifact: async () =>
      buildGraphqlArtifact({
        ProfileCometTimelineFeedRefetchQuery: {
          queryName: "ProfileCometTimelineFeedRefetchQuery",
          docId: "123",
          variables: { scale: 2, id: "100026362418520" },
          preload: []
        }
      }),
    fetchImpl: ((async () =>
      new Response('for (;;);{"data":{"ok":true}}', {
        status: 200,
        headers: { "content-type": "text/plain" }
      })) as unknown) as typeof fetch
  });

  const result = await client.request<{ data: { ok: boolean } }>({
    queryName: "ProfileCometTimelineFeedRefetchQuery"
  });

  expect(result.data.ok).toBe(true);
});

test("graphql client parses newline-delimited json payloads", async () => {
  const client = createGraphqlClient({
    loadArtifact: async () =>
      buildGraphqlArtifact({
        ProfileCometTimelineFeedRefetchQuery: {
          queryName: "ProfileCometTimelineFeedRefetchQuery",
          docId: "123",
          variables: { scale: 2, id: "100026362418520" },
          preload: []
        }
      }),
    fetchImpl: ((async () =>
      new Response(
        '{"data":{"ok":true,"node":{"id":"100026362418520"}}}\n{"extensions":{"is_final":true}}',
        {
          status: 200,
          headers: { "content-type": "text/plain" }
        }
      )) as unknown) as typeof fetch
  });

  const result = await client.request<{ data: { ok: boolean } }>({
    queryName: "ProfileCometTimelineFeedRefetchQuery"
  });

  expect(result.data.ok).toBe(true);
});

test("graphql client returns full payload list for newline-delimited responses when responseMode=all", async () => {
  const client = createGraphqlClient({
    loadArtifact: async () =>
      buildGraphqlArtifact({
        ProfileCometTimelineFeedRefetchQuery: {
          queryName: "ProfileCometTimelineFeedRefetchQuery",
          docId: "123",
          variables: { scale: 2, id: "100026362418520" },
          preload: []
        }
      }),
    fetchImpl: ((async () =>
      new Response(
        '{"data":{"node":{"id":"100026362418520"}}}\n{"data":{"page_info":{"has_next_page":false}}}',
        {
          status: 200,
          headers: { "content-type": "text/plain" }
        }
      )) as unknown) as typeof fetch
  });

  const result = await client.request<Array<Record<string, unknown>>>({
    queryName: "ProfileCometTimelineFeedRefetchQuery",
    responseMode: "all"
  });

  expect(Array.isArray(result)).toBe(true);
  expect(result.length).toBe(2);
});

test("graphql client returns actionable error when response body is empty", async () => {
  const client = createGraphqlClient({
    loadArtifact: async () =>
      buildGraphqlArtifact({
        ProfileCometTimelineFeedRefetchQuery: {
          queryName: "ProfileCometTimelineFeedRefetchQuery",
          docId: "123",
          variables: { scale: 2, id: "100026362418520" },
          preload: []
        }
      }),
    fetchImpl: ((async () => new Response("", { status: 200 })) as unknown) as typeof fetch
  });

  await expect(
    client.request({
      queryName: "ProfileCometTimelineFeedRefetchQuery"
    })
  ).rejects.toThrow("GraphQL response body empty");
});

test("graphql client retries with /graphql/query when default /api/graphql body is empty", async () => {
  const calls: string[] = [];
  const client = createGraphqlClient({
    loadArtifact: async () =>
      buildGraphqlArtifact({
        ProfileCometTimelineFeedRefetchQuery: {
          queryName: "ProfileCometTimelineFeedRefetchQuery",
          docId: "123",
          variables: { scale: 2, id: "100026362418520" },
          preload: []
        }
      }),
    fetchImpl: ((async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      if (url === "/api/graphql/") return new Response("", { status: 200 });
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as unknown) as typeof fetch
  });

  const result = await client.request<{ data: { ok: boolean } }>({
    queryName: "ProfileCometTimelineFeedRefetchQuery"
  });

  expect(result.data.ok).toBe(true);
  expect(calls[0]).toBe("/api/graphql/");
  expect(calls.includes("/graphql/query/")).toBe(true);
});

test("graphql client retries same endpoint without captured request params when stale params fail", async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const client = createGraphqlClient({
    loadArtifact: async () =>
      buildGraphqlArtifact({
        ProfileCometTimelineFeedRefetchQuery: {
          queryName: "ProfileCometTimelineFeedRefetchQuery",
          docId: "123",
          variables: { scale: 2, id: "100026362418520" },
          requestParams: {
            __req: "stale"
          },
          preload: []
        }
      }),
    fetchImpl: ((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const body = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body ?? "");
      calls.push({ url, body });

      if (url === "/api/graphql/" && body.includes("__req=stale")) {
        return new Response("not found", { status: 404 });
      }
      if (url === "/api/graphql/") {
        return new Response(JSON.stringify({ data: { ok: true } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("{}", { status: 500 });
    }) as unknown) as typeof fetch
  });

  const result = await client.request<{ data: { ok: boolean } }>({
    queryName: "ProfileCometTimelineFeedRefetchQuery",
    endpoint: "/api/graphql/"
  });

  expect(result.data.ok).toBe(true);
  expect(calls.length).toBe(2);
  expect(calls[0]?.body.includes("__req=stale")).toBe(true);
  expect(calls[1]?.body.includes("__req=stale")).toBe(false);
});
