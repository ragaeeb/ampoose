import { afterEach, describe, expect, it } from 'bun:test';
import { buildGraphqlArtifact } from '@/domain/calibration/artifact';
import { createGraphqlClient } from '@/domain/graphql/client';

const originalLocationHref = window.location.href;

const artifact = buildGraphqlArtifact({
    ProfileCometTimelineFeedRefetchQuery: {
        docId: '123',
        preload: [],
        queryName: 'ProfileCometTimelineFeedRefetchQuery',
        variables: { id: '456' },
    },
});

afterEach(() => {
    document.body.innerHTML = '';
    document.cookie = '';
    window.location.href = originalLocationHref;
    delete (window as unknown as Record<string, unknown>).__spin_b;
    delete (window as unknown as Record<string, unknown>).__spin_r;
    delete (window as unknown as Record<string, unknown>).__spin_t;
});

describe('graphql client extra branches', () => {
    it('should fail NDJSON parsing when one line is invalid JSON', async () => {
        const client = createGraphqlClient({
            fetchImpl: (async () => new Response('{"data":{"ok":true}}\n{not-json}', { status: 200 })) as unknown as typeof fetch,
            loadArtifact: async () => artifact,
        });

        await expect(
            client.request({
                endpoint: '/api/graphql/',
                queryName: 'ProfileCometTimelineFeedRefetchQuery',
            }),
        ).rejects.toThrow('GraphQL response parse failed');
    });

    it('should use fallback endpoint when not on a facebook host', async () => {
        window.location.href = 'https://example.com/profile';
        const urls: string[] = [];

        const client = createGraphqlClient({
            fetchImpl: (async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
                urls.push(url);
                if (url === '/api/graphql/') {
                    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
                }
                return new Response('not found', { status: 404 });
            }) as unknown as typeof fetch,
            loadArtifact: async () => artifact,
        });

        const result = await client.request<{ data: { ok: boolean } }>({
            queryName: 'ProfileCometTimelineFeedRefetchQuery',
        });

        expect(result.data.ok).toBe(true);
        expect(urls[0]).toBe('/api/graphql/');
    });

    it('should request successfully when document is unavailable', async () => {
        const originalDocument = (globalThis as any).document;
        try {
            delete (globalThis as any).document;
            const client = createGraphqlClient({
                fetchImpl: (async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })) as unknown as typeof fetch,
                loadArtifact: async () => artifact,
            });
            const result = await client.request<{ data: { ok: boolean } }>({
                endpoint: '/api/graphql/',
                queryName: 'ProfileCometTimelineFeedRefetchQuery',
            });
            expect(result.data.ok).toBe(true);
        } finally {
            (globalThis as any).document = originalDocument;
        }
    });

    it("parses responses prefixed with )]}' and picks payload containing errors", async () => {
        const client = createGraphqlClient({
            fetchImpl: (async () =>
                new Response(")]}'\n{\"meta\":1}\n{\"errors\":[{\"message\":\"fail\"}]}", {
                    status: 200,
                })) as unknown as typeof fetch,
            loadArtifact: async () => artifact,
        });

        const result = await client.request<{ errors: Array<{ message: string }> }>({
            endpoint: '/api/graphql/',
            queryName: 'ProfileCometTimelineFeedRefetchQuery',
        });

        expect(result.errors[0]?.message).toBe('fail');
    });

    it('falls back to first NDJSON payload when no data/errors payload exists', async () => {
        const client = createGraphqlClient({
            fetchImpl: (async () => new Response('1\n{"meta":true}', { status: 200 })) as unknown as typeof fetch,
            loadArtifact: async () => artifact,
        });

        const result = await client.request<number>({
            endpoint: '/api/graphql/',
            queryName: 'ProfileCometTimelineFeedRefetchQuery',
        });

        expect(result).toBe(1);
    });

    it('returns parse failure preview for non-json single-line body', async () => {
        const invalid = 'x'.repeat(400);
        const client = createGraphqlClient({
            fetchImpl: (async () => new Response(invalid, { status: 200 })) as unknown as typeof fetch,
            loadArtifact: async () => artifact,
        });

        await expect(
            client.request({
                endpoint: '/api/graphql/',
                queryName: 'ProfileCometTimelineFeedRefetchQuery',
            }),
        ).rejects.toThrow('GraphQL response parse failed');
    });

    it('omits preview in request failure when body is empty after trimming', async () => {
        const client = createGraphqlClient({
            fetchImpl: (async () => new Response('   ', { status: 500 })) as unknown as typeof fetch,
            loadArtifact: async () => artifact,
        });

        await expect(
            client.request({
                endpoint: '/api/graphql/',
                queryName: 'ProfileCometTimelineFeedRefetchQuery',
            }),
        ).rejects.toThrow('GraphQL request failed: 500');
    });

    it('gracefully skips ambient params when document access fails or values are empty', async () => {
        // biome-ignore lint/suspicious/noDocumentCookie: this test validates cookie parse fallback
        document.cookie = 'c_user=%E0%A4%A;';
        const originalQuerySelector = document.querySelector.bind(document);
        document.querySelector = (() => {
            throw new Error('selector blocked');
        }) as typeof document.querySelector;

        const calls: URLSearchParams[] = [];
        const client = createGraphqlClient({
            fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
                const body = new URLSearchParams(String(init?.body ?? ''));
                calls.push(body);
                return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
            }) as typeof fetch,
            loadArtifact: async () => artifact,
        });

        try {
            const result = await client.request<{ data: { ok: boolean } }>({
                endpoint: '/api/graphql/',
                queryName: 'ProfileCometTimelineFeedRefetchQuery',
            });

            expect(result.data.ok).toBe(true);
            const params = calls[0]!;
            expect(params.get('__user')).toBeNull();
            expect(params.get('av')).toBeNull();
            expect(params.get('fb_dtsg')).toBeNull();
            expect(params.get('jazoest')).toBeNull();
            expect(params.get('lsd')).toBeNull();
        } finally {
            document.querySelector = originalQuerySelector;
        }
    });

    it('tries www.facebook.com fallback endpoints when running on web.facebook.com', async () => {
        window.location.href = 'https://web.facebook.com/profile';
        const urls: string[] = [];

        const client = createGraphqlClient({
            fetchImpl: (async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
                urls.push(url);
                if (url === 'https://www.facebook.com/graphql/query/') {
                    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
                }
                return new Response('not found', { status: 404 });
            }) as typeof fetch,
            loadArtifact: async () => artifact,
        });

        const result = await client.request<{ data: { ok: boolean } }>({
            queryName: 'ProfileCometTimelineFeedRefetchQuery',
        });

        expect(result.data.ok).toBe(true);
        expect(urls.includes('https://www.facebook.com/api/graphql/')).toBe(true);
        expect(urls.includes('https://www.facebook.com/graphql/query/')).toBe(true);
    });
});
