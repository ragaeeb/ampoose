import { expect, it, mock } from 'bun:test';
import {
    buildGraphqlArtifact,
    getMissingRequiredQueries,
    normalizeGraphqlArtifact,
} from '@/domain/calibration/artifact';
import { createGraphqlClient } from '@/domain/graphql/client';

it('should handle missing/partial/valid calibration contract', () => {
    const missing = normalizeGraphqlArtifact(null);
    expect(missing).toBeNull();

    const partial = normalizeGraphqlArtifact({
        entries: {
            ProfileCometTimelineFeedRefetchQuery: {
                docId: '123',
                preload: [],
                queryName: 'ProfileCometTimelineFeedRefetchQuery',
                variables: { id: '100026362418520' },
            },
        },
        schemaVersion: 1,
        updatedAt: '2026-02-11T00:00:00.000Z',
    });

    expect(partial).not.toBeNull();
    expect(getMissingRequiredQueries(partial)).toEqual([]);

    const valid = buildGraphqlArtifact({
        CometSinglePostDialogContentQuery: {
            docId: '456',
            preload: [],
            queryName: 'CometSinglePostDialogContentQuery',
            variables: { scale: 1 },
        },
        ProfileCometTimelineFeedRefetchQuery: {
            docId: '123',
            preload: [],
            queryName: 'ProfileCometTimelineFeedRefetchQuery',
            variables: { id: '100026362418520', scale: 1 },
        },
    });

    expect(getMissingRequiredQueries(valid)).toEqual([]);
});

it('should require timeline entry to include profile id', () => {
    const partialMissingId = normalizeGraphqlArtifact({
        entries: {
            ProfileCometTimelineFeedRefetchQuery: {
                docId: '123',
                preload: [],
                queryName: 'ProfileCometTimelineFeedRefetchQuery',
                variables: {},
            },
        },
        schemaVersion: 1,
        updatedAt: '2026-02-11T00:00:00.000Z',
    });

    expect(partialMissingId).not.toBeNull();
    expect(getMissingRequiredQueries(partialMissingId)).toEqual(['ProfileCometTimelineFeedRefetchQuery']);
});

it('should fail fast when calibration is missing', async () => {
    const client = createGraphqlClient({
        fetchImpl: mock(async () => new Response('{}')) as unknown as typeof fetch,
        loadArtifact: async () => null,
    });

    await expect(
        client.request({
            queryName: 'ProfileCometTimelineFeedRefetchQuery',
        }),
    ).rejects.toThrow('Calibration missing required entries');
});

it('should use local calibration entries and not depend on graphql-info host', async () => {
    const calls: Array<{ url: string; body: string }> = [];

    const client = createGraphqlClient({
        fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            const body = init?.body;
            calls.push({
                body: body instanceof URLSearchParams ? body.toString() : String(body ?? ''),
                url,
            });
            return new Response(JSON.stringify({ ok: true }), {
                headers: { 'content-type': 'application/json' },
                status: 200,
            });
        }) as typeof fetch,
        loadArtifact: async () =>
            buildGraphqlArtifact({
                CometSinglePostDialogContentQuery: {
                    docId: '456',
                    preload: [],
                    queryName: 'CometSinglePostDialogContentQuery',
                    variables: { scale: 2 },
                },
                ProfileCometTimelineFeedRefetchQuery: {
                    docId: '123',
                    preload: [],
                    queryName: 'ProfileCometTimelineFeedRefetchQuery',
                    requestParams: {
                        __a: '1',
                    },
                    variables: { id: '100026362418520', scale: 2 },
                },
            }),
    });

    const result = await client.request<{ ok: boolean }>({
        endpoint: '/api/graphql/',
        queryName: 'ProfileCometTimelineFeedRefetchQuery',
        variables: { cursor: 'abc' },
    });

    expect(result.ok).toBeTrue();
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe('/api/graphql/');
    expect(calls[0]?.body.includes('doc_id=123')).toBeTrue();
    expect(calls[0]?.body.includes('__a=1')).toBeTrue();
});

it('should parse anti-hijacking prefixed JSON responses', async () => {
    const client = createGraphqlClient({
        fetchImpl: (async () =>
            new Response('for (;;);{"data":{"ok":true}}', {
                headers: { 'content-type': 'text/plain' },
                status: 200,
            })) as unknown as typeof fetch,
        loadArtifact: async () =>
            buildGraphqlArtifact({
                ProfileCometTimelineFeedRefetchQuery: {
                    docId: '123',
                    preload: [],
                    queryName: 'ProfileCometTimelineFeedRefetchQuery',
                    variables: { id: '100026362418520', scale: 2 },
                },
            }),
    });

    const result = await client.request<{ data: { ok: boolean } }>({
        queryName: 'ProfileCometTimelineFeedRefetchQuery',
    });

    expect(result.data.ok).toBeTrue();
});

it('should parse newline-delimited json payloads', async () => {
    const client = createGraphqlClient({
        fetchImpl: (async () =>
            new Response('{"data":{"ok":true,"node":{"id":"100026362418520"}}}\n{"extensions":{"is_final":true}}', {
                headers: { 'content-type': 'text/plain' },
                status: 200,
            })) as unknown as typeof fetch,
        loadArtifact: async () =>
            buildGraphqlArtifact({
                ProfileCometTimelineFeedRefetchQuery: {
                    docId: '123',
                    preload: [],
                    queryName: 'ProfileCometTimelineFeedRefetchQuery',
                    variables: { id: '100026362418520', scale: 2 },
                },
            }),
    });

    const result = await client.request<{ data: { ok: boolean } }>({
        queryName: 'ProfileCometTimelineFeedRefetchQuery',
    });

    expect(result.data.ok).toBeTrue();
});

it('should return full payload list for newline-delimited responses when responseMode=all', async () => {
    const client = createGraphqlClient({
        fetchImpl: (async () =>
            new Response('{"data":{"node":{"id":"100026362418520"}}}\n{"data":{"page_info":{"has_next_page":false}}}', {
                headers: { 'content-type': 'text/plain' },
                status: 200,
            })) as unknown as typeof fetch,
        loadArtifact: async () =>
            buildGraphqlArtifact({
                ProfileCometTimelineFeedRefetchQuery: {
                    docId: '123',
                    preload: [],
                    queryName: 'ProfileCometTimelineFeedRefetchQuery',
                    variables: { id: '100026362418520', scale: 2 },
                },
            }),
    });

    const result = await client.request<Array<Record<string, unknown>>>({
        queryName: 'ProfileCometTimelineFeedRefetchQuery',
        responseMode: 'all',
    });

    expect(Array.isArray(result)).toBeTrue();
    expect(result.length).toBe(2);
});

it('should return actionable error when response body is empty', async () => {
    const client = createGraphqlClient({
        fetchImpl: (async () => new Response('', { status: 200 })) as unknown as typeof fetch,
        loadArtifact: async () =>
            buildGraphqlArtifact({
                ProfileCometTimelineFeedRefetchQuery: {
                    docId: '123',
                    preload: [],
                    queryName: 'ProfileCometTimelineFeedRefetchQuery',
                    variables: { id: '100026362418520', scale: 2 },
                },
            }),
    });

    await expect(
        client.request({
            queryName: 'ProfileCometTimelineFeedRefetchQuery',
        }),
    ).rejects.toThrow('GraphQL response body empty');
});

it('should retry with /graphql/query when default /api/graphql body is empty', async () => {
    const calls: string[] = [];
    const client = createGraphqlClient({
        fetchImpl: (async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            calls.push(url);
            if (url === '/api/graphql/') {
                return new Response('', { status: 200 });
            }
            return new Response(JSON.stringify({ data: { ok: true } }), {
                headers: { 'content-type': 'application/json' },
                status: 200,
            });
        }) as unknown as typeof fetch,
        loadArtifact: async () =>
            buildGraphqlArtifact({
                ProfileCometTimelineFeedRefetchQuery: {
                    docId: '123',
                    preload: [],
                    queryName: 'ProfileCometTimelineFeedRefetchQuery',
                    variables: { id: '100026362418520', scale: 2 },
                },
            }),
    });

    const result = await client.request<{ data: { ok: boolean } }>({
        queryName: 'ProfileCometTimelineFeedRefetchQuery',
    });

    expect(result.data.ok).toBeTrue();
    expect(calls[0]).toBe('/api/graphql/');
    expect(calls.includes('/graphql/query/')).toBeTrue();
});

it('should retry same endpoint without captured request params when stale params fail', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const client = createGraphqlClient({
        fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            const body = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body ?? '');
            calls.push({ body, url });

            if (url === '/api/graphql/' && body.includes('__req=stale')) {
                return new Response('not found', { status: 404 });
            }
            if (url === '/api/graphql/') {
                return new Response(JSON.stringify({ data: { ok: true } }), {
                    headers: { 'content-type': 'application/json' },
                    status: 200,
                });
            }
            return new Response('{}', { status: 500 });
        }) as unknown as typeof fetch,
        loadArtifact: async () =>
            buildGraphqlArtifact({
                ProfileCometTimelineFeedRefetchQuery: {
                    docId: '123',
                    preload: [],
                    queryName: 'ProfileCometTimelineFeedRefetchQuery',
                    requestParams: {
                        __req: 'stale',
                    },
                    variables: { id: '100026362418520', scale: 2 },
                },
            }),
    });

    const result = await client.request<{ data: { ok: boolean } }>({
        endpoint: '/api/graphql/',
        queryName: 'ProfileCometTimelineFeedRefetchQuery',
    });

    expect(result.data.ok).toBeTrue();
    expect(calls.length).toBe(2);
    expect(calls[0]?.body.includes('__req=stale')).toBeTrue();
    expect(calls[1]?.body.includes('__req=stale')).toBeFalse();
});
