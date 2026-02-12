import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { buildGraphqlArtifact } from '@/domain/calibration/artifact';
import type { GraphqlArtifactV1 } from '@/domain/types';
import { RunController } from '@/runtime/controller/runController';

function makeReadyArtifact(): GraphqlArtifactV1 {
    return buildGraphqlArtifact({
        ProfileCometTimelineFeedRefetchQuery: {
            docId: '123',
            preload: [],
            queryName: 'ProfileCometTimelineFeedRefetchQuery',
            variables: { id: '456' },
        },
    });
}

describe('RunController (extra)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('should subscribe immediately and support setOpen/updateSettings', () => {
        const controller = new RunController({
            calibrationClient: {
                buildArtifact: mock(async () => ({})),
                getStatus: mock(async () => ({ active: false, captureCount: 0, missing: ['x'] })),
                startCapture: mock(async () => {}),
                stopCapture: mock(async () => {}),
            },
            downloadClient: {
                downloadTextAsFile: mock(async () => ({ ok: true })),
            },
            loadCalibration: mock(async () => null),
            queryPage: mock(async () => ({ nextCursor: null, posts: [] })),
            saveCalibration: mock(async () => {}),
        });

        const states: any[] = [];
        const unsubscribe = controller.subscribe((state) => states.push(state));
        expect(states.length).toBe(1);

        controller.setOpen(true);
        expect(states.at(-1)?.open).toBe(true);

        controller.updateSettings({ isUsePostsFilter: true });
        expect(states.at(-1)?.settings?.isUsePostsFilter).toBe(true);

        unsubscribe();
        controller.setOpen(false);
        expect(states.at(-1)?.open).toBe(true);
    });

    it('should stop immediately and set DONE step', () => {
        const controller = new RunController({
            calibrationClient: {
                buildArtifact: mock(async () => ({})),
                getStatus: mock(async () => ({ active: false, captureCount: 0, missing: ['x'] })),
                startCapture: mock(async () => {}),
                stopCapture: mock(async () => {}),
            },
            downloadClient: {
                downloadTextAsFile: mock(async () => ({ ok: true })),
            },
            loadCalibration: mock(async () => makeReadyArtifact()),
            queryPage: mock(async () => ({ nextCursor: null, posts: [] })),
            saveCalibration: mock(async () => {}),
        });

        (controller as any).abortController = new AbortController();
        controller.stop();

        const state = controller.getState();
        expect(state.step).toBe('DONE');
        expect(state.isStopManually).toBe(true);
        expect(state.logs.some((entry) => entry.msg.includes('run: stopped manually'))).toBe(true);
    });

    it('should save calibration from capture when complete', async () => {
        const saveCalibration = mock(async () => {});
        const stopCapture = mock(async () => {});

        const controller = new RunController({
            calibrationClient: {
                buildArtifact: mock(async () => makeReadyArtifact()),
                getStatus: mock(async () => ({
                    active: true,
                    captureCount: 2,
                    capturedNames: ['ProfileCometTimelineFeedRefetchQuery'],
                    missing: [],
                    unmatchedNames: [],
                })),
                startCapture: mock(async () => {}),
                stopCapture,
            },
            downloadClient: {
                downloadTextAsFile: mock(async () => ({ ok: true })),
            },
            loadCalibration: mock(async () => null),
            queryPage: mock(async () => ({ nextCursor: null, posts: [] })),
            saveCalibration,
        });

        await controller.saveCalibrationFromCapture();
        expect(saveCalibration).toHaveBeenCalledTimes(1);
        expect(stopCapture).toHaveBeenCalledTimes(1);
        expect(controller.getState().calibrationStatus).toBe('ready');
    });

    it('should log a warning when calibration capture is incomplete', async () => {
        const saveCalibration = mock(async () => {});
        const controller = new RunController({
            calibrationClient: {
                buildArtifact: mock(async () => makeReadyArtifact()),
                getStatus: mock(async () => ({
                    active: true,
                    captureCount: 1,
                    capturedNames: ['SomeOtherQuery'],
                    missing: ['ProfileCometTimelineFeedRefetchQuery'],
                    unmatchedNames: ['WeirdQuery'],
                })),
                startCapture: mock(async () => {}),
                stopCapture: mock(async () => {}),
            },
            downloadClient: {
                downloadTextAsFile: mock(async () => ({ ok: true })),
            },
            loadCalibration: mock(async () => null),
            queryPage: mock(async () => ({ nextCursor: null, posts: [] })),
            saveCalibration,
        });

        await controller.saveCalibrationFromCapture();
        expect(saveCalibration).toHaveBeenCalledTimes(0);
        expect(controller.getState().logs.some((entry) => entry.type === 'warn')).toBe(true);
    });

    it('should run calibration automation quickly when a post link is present', async () => {
        const saveCalibration = mock(async () => {});
        const stopCapture = mock(async () => {});

        document.body.innerHTML =
            "<a href='https://www.facebook.com/permalink.php?story_fbid=123&fbid=123'>post</a>";

        const scrollBy = mock(() => {});
        (window as any).scrollBy = scrollBy;

        const controller = new RunController({
            calibrationClient: {
                buildArtifact: mock(async () => makeReadyArtifact()),
                getStatus: mock(async () => ({
                    active: true,
                    captureCount: 1,
                    capturedNames: ['ProfileCometTimelineFeedRefetchQuery'],
                    missing: [],
                    unmatchedNames: [],
                })),
                startCapture: mock(async () => {}),
                stopCapture,
            },
            downloadClient: {
                downloadTextAsFile: mock(async () => ({ ok: true })),
            },
            loadCalibration: mock(async () => null),
            queryPage: mock(async () => ({ nextCursor: null, posts: [] })),
            saveCalibration,
        });

        // Make automation deterministic (no real sleeps).
        (controller as any).sleep = async () => {};

        await controller.startCalibrationCapture();
        await (controller as any).calibrationAutoTask;

        expect(scrollBy).toHaveBeenCalled();
        expect(saveCalibration).toHaveBeenCalledTimes(1);
        expect(stopCapture).toHaveBeenCalledTimes(1);
    });
});

