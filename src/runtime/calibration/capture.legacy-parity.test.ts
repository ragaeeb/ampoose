import { expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { createCalibrationCaptureManager } from '@/runtime/calibration/capture';

it('should record required query docIds from graphql requests', async () => {
    const windowObj = new Window({ url: 'https://www.facebook.com/' });
    const originalWindow = globalThis.window;
    const originalXHR = globalThis.XMLHttpRequest;
    const originalFormData = globalThis.FormData;

    globalThis.window = windowObj as any;
    globalThis.XMLHttpRequest = windowObj.XMLHttpRequest as any;
    globalThis.FormData = windowObj.FormData as any;

    windowObj.fetch = async () => new windowObj.Response('{}', { status: 200 });

    try {
        const manager = createCalibrationCaptureManager();
        manager.start();

        await windowObj.fetch('/api/graphql/', {
            body: new URLSearchParams({
                __a: '1',
                doc_id: '111',
                fb_api_req_friendly_name: 'ProfileCometTimelineFeedRefetchQuery',
                variables: JSON.stringify({ cursor: 'abc', id: 'profile-id-1', scale: 2 }),
            }),
            method: 'POST',
        });

        await windowObj.fetch('/api/graphql/', {
            body: new URLSearchParams({
                doc_id: '222',
                fb_api_req_friendly_name: 'CometSinglePostDialogContentQuery',
                variables: JSON.stringify({ scale: 2, story_id: '123' }),
            }),
            method: 'POST',
        });

        expect(manager.getCaptureCount()).toBe(2);
        expect(manager.getMissing()).toEqual([]);

        const artifact = manager.buildArtifact();
        expect(artifact.entries.ProfileCometTimelineFeedRefetchQuery?.docId).toBe('111');
        expect(artifact.entries.CometSinglePostDialogContentQuery?.docId).toBe('222');
        expect('cursor' in artifact.entries.ProfileCometTimelineFeedRefetchQuery!.variables).toBe(false);
        expect(artifact.entries.ProfileCometTimelineFeedRefetchQuery?.variables.id).toBe('profile-id-1');
        expect(artifact.entries.ProfileCometTimelineFeedRefetchQuery?.requestParams?.__a).toBeUndefined();
    } finally {
        globalThis.window = originalWindow;
        globalThis.XMLHttpRequest = originalXHR;
        globalThis.FormData = originalFormData;
    }
});

it('should support batched `queries` payload shape', async () => {
    const windowObj = new Window({ url: 'https://www.facebook.com/' });
    const originalWindow = globalThis.window;
    const originalXHR = globalThis.XMLHttpRequest;
    const originalFormData = globalThis.FormData;

    globalThis.window = windowObj as any;
    globalThis.XMLHttpRequest = windowObj.XMLHttpRequest as any;
    globalThis.FormData = windowObj.FormData as any;

    windowObj.fetch = async () => new windowObj.Response('{}', { status: 200 });

    try {
        const manager = createCalibrationCaptureManager();
        manager.start();

        await windowObj.fetch('/api/graphql/', {
            body: new URLSearchParams({
                queries: JSON.stringify({
                    a: {
                        doc_id: 'aaa',
                        queryName: 'ProfileCometTimelineFeedRefetchQuery',
                        variables: JSON.stringify({ cursor: 'abc', id: 'profile-id-1', scale: 2 }),
                    },
                    b: {
                        docId: 'bbb',
                        fb_api_req_friendly_name: 'CometSinglePostDialogContentQuery',
                        variables: JSON.stringify({ scale: 2, story_id: '123' }),
                    },
                }),
            }),
            method: 'POST',
        });

        expect(manager.getMissing()).toEqual([]);
        const artifact = manager.buildArtifact();
        expect(artifact.entries.ProfileCometTimelineFeedRefetchQuery?.docId).toBe('aaa');
        expect(artifact.entries.CometSinglePostDialogContentQuery?.docId).toBe('bbb');
    } finally {
        globalThis.window = originalWindow;
        globalThis.XMLHttpRequest = originalXHR;
        globalThis.FormData = originalFormData;
    }
});

it('should handle Request input bodies and query-name aliases', async () => {
    const windowObj = new Window({ url: 'https://www.facebook.com/' });
    const originalWindow = globalThis.window;
    const originalXHR = globalThis.XMLHttpRequest;
    const originalFormData = globalThis.FormData;

    globalThis.window = windowObj as any;
    globalThis.XMLHttpRequest = windowObj.XMLHttpRequest as any;
    globalThis.FormData = windowObj.FormData as any;

    windowObj.fetch = async () => new windowObj.Response('{}', { status: 200 });

    try {
        const manager = createCalibrationCaptureManager();
        manager.start();

        await windowObj.fetch(
            'https://www.facebook.com/api/graphql/?fb_api_req_friendly_name=ProfileCometTimelineFeedRefetchQuery&doc_id=111&variables=%7B%22scale%22%3A2%2C%22id%22%3A%22profile-id-1%22%7D',
        );

        const singlePostRequest = new windowObj.Request('https://www.facebook.com/graphql/query/', {
            body: new URLSearchParams({
                doc_id: '222',
                // Real-world variants should still map to the required single-post key.
                fb_api_req_friendly_name: 'CometFocusedStoryViewUFIQuery',
                variables: JSON.stringify({ scale: 2, story_id: '123' }),
            }).toString(),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            method: 'POST',
        });

        await windowObj.fetch(singlePostRequest);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(manager.getMissing()).toEqual([]);
        const artifact = manager.buildArtifact();
        expect(artifact.entries.ProfileCometTimelineFeedRefetchQuery?.docId).toBe('111');
        expect(artifact.entries.CometSinglePostDialogContentQuery?.docId).toBe('222');
    } finally {
        globalThis.window = originalWindow;
        globalThis.XMLHttpRequest = originalXHR;
        globalThis.FormData = originalFormData;
    }
});

it('should expose unmatched graphql query names for diagnostics', async () => {
    const windowObj = new Window({ url: 'https://www.facebook.com/' });
    const originalWindow = globalThis.window;
    const originalXHR = globalThis.XMLHttpRequest;
    const originalFormData = globalThis.FormData;

    globalThis.window = windowObj as any;
    globalThis.XMLHttpRequest = windowObj.XMLHttpRequest as any;
    globalThis.FormData = windowObj.FormData as any;

    windowObj.fetch = async () => new windowObj.Response('{}', { status: 200 });

    try {
        const manager = createCalibrationCaptureManager();
        manager.start();

        await windowObj.fetch('/api/graphql/', {
            body: new URLSearchParams({
                doc_id: 'xyz',
                fb_api_req_friendly_name: 'CometSomeOtherStoryQuery',
                variables: JSON.stringify({ story_id: '123' }),
            }),
            method: 'POST',
        });

        expect(manager.getCaptureCount()).toBe(0);
        expect(manager.getUnmatchedNames()).toContain('CometSomeOtherStoryQuery');
    } finally {
        globalThis.window = originalWindow;
        globalThis.XMLHttpRequest = originalXHR;
        globalThis.FormData = originalFormData;
    }
});
