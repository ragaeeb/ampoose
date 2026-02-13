import { afterEach, describe, expect, it, mock } from 'bun:test';
import { buildGraphqlArtifact } from '@/domain/calibration/artifact';
import { createGraphqlClient } from '@/domain/graphql/client';

describe('graphql client ambient params', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        document.cookie = '';
        delete (window as unknown as Record<string, unknown>).__spin_b;
        delete (window as unknown as Record<string, unknown>).__spin_r;
        delete (window as unknown as Record<string, unknown>).__spin_t;
        delete (window as unknown as Record<string, unknown>).devicePixelRatio;
    });

    it('should include ambient params from cookies, inputs, and window spin values', async () => {
        // biome-ignore lint/suspicious/noDocumentCookie: this code path reads document.cookie
        document.cookie = 'c_user=123;';
        document.body.innerHTML = `
            <input name="fb_dtsg" value="ABC" />
            <input name="lsd" value="LSDVALUE" />
        `;

        (window as any).__spin_b = 'spinb';
        (window as any).__spin_r = 101;
        (window as any).__spin_t = 202;
        (window as any).devicePixelRatio = 2;

        const fetchImpl = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const bodyText = String(init?.body ?? '');
            const params = new URLSearchParams(bodyText);

            expect(params.get('fb_api_req_friendly_name')).toBe('ProfileCometTimelineFeedRefetchQuery');
            expect(params.get('doc_id')).toBe('123');
            expect(params.get('variables')).toBe(JSON.stringify({ id: '456' }));

            expect(params.get('__user')).toBe('123');
            expect(params.get('av')).toBe('123');
            expect(params.get('fb_dtsg')).toBe('ABC');
            expect(params.get('jazoest')).toBeTruthy();
            expect(params.get('lsd')).toBe('LSDVALUE');
            expect(params.get('__spin_b')).toBe('spinb');
            expect(params.get('__spin_r')).toBe('101');
            expect(params.get('__spin_t')).toBe('202');
            expect(params.get('dpr')).toBe('2');

            return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
        });

        const artifact = buildGraphqlArtifact({
            ProfileCometTimelineFeedRefetchQuery: {
                docId: '123',
                preload: [],
                queryName: 'ProfileCometTimelineFeedRefetchQuery',
                variables: { id: '456' },
            },
        });

        const client = createGraphqlClient({
            fetchImpl: fetchImpl as unknown as typeof fetch,
            loadArtifact: async () => artifact,
        });

        const response = await client.request({ queryName: 'ProfileCometTimelineFeedRefetchQuery' });
        expect((response as any).data.ok).toBeTrue();
    });
});
