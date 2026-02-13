import { describe, expect, it, mock } from 'bun:test';
import { createCalibrationCaptureManager } from '@/runtime/calibration/capture';

function stubFetch() {
    const original = window.fetch;
    (window as any).fetch = mock(async () => new Response('{}', { status: 200 }));
    return () => {
        (window as any).fetch = original;
    };
}

describe('calibration capture (extra)', () => {
    it('should capture doc ids from JSON string bodies', async () => {
        const restore = stubFetch();
        const manager = createCalibrationCaptureManager();
        manager.start();

        const body = JSON.stringify({
            doc_id: '111',
            fb_api_req_friendly_name: 'timeline refetch query',
            lsd: 'keep-this',
            variables: { __spin_r: 'should-strip', cursor: 'abc', id: 'profile-id' },
        });

        await window.fetch('/api/graphql/', { body, method: 'POST' });

        expect(manager.getCaptureCount()).toBe(1);
        expect(manager.getCapturedNames()).toContain('ProfileCometTimelineFeedRefetchQuery');
        expect(manager.getUnmatchedNames()).toEqual([]);

        const artifact = manager.buildArtifact();
        expect((artifact as any).entries.ProfileCometTimelineFeedRefetchQuery.docId).toBe('111');
        expect((artifact as any).entries.ProfileCometTimelineFeedRefetchQuery.variables.cursor).toBeUndefined();
        expect((artifact as any).entries.ProfileCometTimelineFeedRefetchQuery.requestParams?.lsd).toBeUndefined();

        restore();
    });

    it('should capture doc ids from FormData bodies', async () => {
        const restore = stubFetch();
        const manager = createCalibrationCaptureManager();
        manager.start();

        const form = new FormData();
        form.set('fb_api_req_friendly_name', 'CometSinglePostDialogContentQuery');
        form.set('doc_id', '222');
        form.set('variables', JSON.stringify({ storyID: 'x' }));

        await window.fetch('/api/graphql/', { body: form, method: 'POST' });

        expect(manager.getCapturedNames()).toContain('CometSinglePostDialogContentQuery');
        expect((manager.buildArtifact() as any).entries.CometSinglePostDialogContentQuery.docId).toBe('222');

        restore();
    });

    it('should track unmatched query names', async () => {
        const restore = stubFetch();
        const manager = createCalibrationCaptureManager();
        manager.start();

        const params = new URLSearchParams();
        params.set('fb_api_req_friendly_name', 'RandomUnknownQuery');
        params.set('doc_id', '333');
        params.set('variables', JSON.stringify({ id: 'x' }));

        await window.fetch('/api/graphql/', { body: params, method: 'POST' });

        expect(manager.getCaptureCount()).toBe(0);
        expect(manager.getUnmatchedNames()).toContain('RandomUnknownQuery');

        restore();
    });

    it('should ignore non-graphql requests and stop capturing after stop()', async () => {
        const restore = stubFetch();
        const manager = createCalibrationCaptureManager();
        manager.start();

        await window.fetch('/api/timeline/', {
            body: JSON.stringify({ doc_id: '111', fb_api_req_friendly_name: 'ProfileCometTimelineFeedRefetchQuery' }),
            method: 'POST',
        });
        expect(manager.getCaptureCount()).toBe(0);

        manager.stop();
        await window.fetch('/api/graphql/', {
            body: JSON.stringify({ doc_id: '111', fb_api_req_friendly_name: 'ProfileCometTimelineFeedRefetchQuery' }),
            method: 'POST',
        });
        expect(manager.getCaptureCount()).toBe(0);

        restore();
    });

    it('should capture from object bodies', async () => {
        const restore = stubFetch();
        const manager = createCalibrationCaptureManager();
        manager.start();

        await window.fetch('/api/graphql/', {
            body: {
                doc_id: '778',
                fb_api_req_friendly_name: 'CometSinglePostDialogContentQuery',
                variables: { storyID: 'x' },
            } as any,
            method: 'POST',
        });

        expect(manager.getCapturedNames()).toContain('CometSinglePostDialogContentQuery');

        const artifact = manager.buildArtifact();
        expect((artifact as any).entries.CometSinglePostDialogContentQuery.docId).toBe('778');
        restore();
    });

    it('should sanitize request params and canonicalize regex-based query names', async () => {
        const restore = stubFetch();
        const manager = createCalibrationCaptureManager();
        manager.start();

        await window.fetch('https://www.facebook.com/api/graphql/', {
            body: JSON.stringify({
                __a: '1',
                __csr: 'csr',
                __req: '3',
                __s: 'abc',
                __spin_r: 'x',
                doc_id: '779',
                empty: '',
                fb_api_req_friendly_name: 'profilecomettimelinefeedrefetchquery_alias',
                kept: '1',
                lsd: 'secret',
                variables: 123,
            }),
            method: 'POST',
        });
        await window.fetch('/api/graphql/', {
            body: JSON.stringify({
                doc_id: '780',
                fb_api_req_friendly_name: 'cometsinglepostdialogcontentquery_alias',
                variables: { id: 'ok' },
            }),
            method: 'POST',
        });

        const artifact = manager.buildArtifact() as any;
        expect(artifact.entries.ProfileCometTimelineFeedRefetchQuery.docId).toBe('779');
        expect(artifact.entries.CometSinglePostDialogContentQuery.docId).toBe('780');
        expect(artifact.entries.ProfileCometTimelineFeedRefetchQuery.requestParams).toEqual({
            kept: '1',
        });
        expect(artifact.entries.ProfileCometTimelineFeedRefetchQuery.variables).toEqual({});
        restore();
    });

    it('should ignore non-string urls and readRequestBody edge cases from request-like inputs', async () => {
        const restore = stubFetch();
        const manager = createCalibrationCaptureManager();
        manager.start();

        await (window.fetch as any)({ url: 123 }, { body: 777, method: 'POST' });
        expect(manager.getCaptureCount()).toBe(0);

        await (window.fetch as any)({
            clone: () => {
                throw new Error('clone failed');
            },
            url: '/api/graphql/',
        });
        expect(manager.getCaptureCount()).toBe(0);

        await (window.fetch as any)({
            clone: () => ({
                text: async () => '',
            }),
            url: '/api/graphql/',
        });
        expect(manager.getCaptureCount()).toBe(0);
        restore();
    });

    it('should patch xhr open/send and keep a single hook installation across repeated start()', () => {
        const restore = stubFetch();
        const originalXMLHttpRequest = (globalThis as any).XMLHttpRequest;
        const openCalls: Array<{ method: string; url: string | URL }> = [];
        const sendBodies: unknown[] = [];

        class FakeXmlHttpRequest {
            open(method: string, url: string | URL, ..._rest: unknown[]) {
                openCalls.push({ method, url });
            }
            send(body?: Document | XMLHttpRequestBodyInit | null) {
                sendBodies.push(body);
            }
        }

        try {
            (globalThis as any).XMLHttpRequest = FakeXmlHttpRequest as any;
            const manager = createCalibrationCaptureManager();
            manager.start();
            manager.start();

            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/graphql/');
            xhr.send(
                new URLSearchParams({
                    doc_id: '881',
                    fb_api_req_friendly_name: 'ProfileCometTimelineFeedRefetchQuery',
                    variables: JSON.stringify({ id: 'x' }),
                }),
            );

            expect(openCalls.length).toBe(1);
            expect(sendBodies.length).toBe(1);
            expect(manager.getCapturedNames()).toContain('ProfileCometTimelineFeedRefetchQuery');
        } finally {
            (globalThis as any).XMLHttpRequest = originalXMLHttpRequest;
            restore();
        }
    });
});
