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
            fb_api_req_friendly_name: 'timeline refetch query',
            doc_id: '111',
            variables: { cursor: 'abc', id: 'profile-id', __spin_r: 'should-strip' },
            lsd: 'keep-this',
        });

        await window.fetch('/api/graphql/', { method: 'POST', body });

        expect(manager.getCaptureCount()).toBe(1);
        expect(manager.getCapturedNames()).toContain('ProfileCometTimelineFeedRefetchQuery');
        expect(manager.getUnmatchedNames()).toEqual([]);

        const artifact = manager.buildArtifact();
        expect((artifact as any).entries.ProfileCometTimelineFeedRefetchQuery.docId).toBe('111');
        expect((artifact as any).entries.ProfileCometTimelineFeedRefetchQuery.variables.cursor).toBeUndefined();
        expect((artifact as any).entries.ProfileCometTimelineFeedRefetchQuery.requestParams.lsd).toBe('keep-this');

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

        await window.fetch('/api/graphql/', { method: 'POST', body: form });

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

        await window.fetch('/api/graphql/', { method: 'POST', body: params });

        expect(manager.getCaptureCount()).toBe(0);
        expect(manager.getUnmatchedNames()).toContain('RandomUnknownQuery');

        restore();
    });
});

