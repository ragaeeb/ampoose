import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { buildGraphqlArtifact } from '@/domain/calibration/artifact';
import type { GraphqlArtifactV1 } from '@/domain/types';
import { RunController } from '@/runtime/controller/runController';
import { FETCH_MODE } from '@/runtime/settings/types';

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

    it('should resume from next cursor on continue without resetting run state', async () => {
        let calls = 0;
        const queryPage = mock(async ({ cursor }: { cursor: string | null }) => {
            calls += 1;
            if (!cursor && calls === 1) {
                const nowMs = Date.now();
                return {
                    nextCursor: 'next',
                    posts: [
                        { content: 'first', createdAt: nowMs, post_id: '1' },
                        { content: 'old-boundary', createdAt: Math.floor((nowMs - 8 * 24 * 60 * 60 * 1000) / 1000), post_id: 'old-boundary' },
                    ],
                };
            }
            return {
                nextCursor: null,
                posts: [{ content: 'second', createdAt: Date.now(), post_id: '2' }],
            };
        });

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
                stopCapture: mock(async () => {}),
            },
            downloadClient: {
                downloadTextAsFile: mock(async () => ({ ok: true })),
            },
            loadCalibration: mock(async () => makeReadyArtifact()),
            queryPage,
            saveCalibration: mock(async () => {}),
        });

        controller.updateSettings({
            fetchingCountByPostDaysValue: 3,
            fetchingCountType: FETCH_MODE.BY_DAYS_COUNT,
            isUsePostsFilter: true,
        });

        await controller.start({ cursor: null, resume: false });
        const firstState = controller.getState();
        expect(firstState.posts.map((post) => String(post.post_id))).toEqual(['1']);
        expect(firstState.progress.nextCursor).toBe('next');
        expect(firstState.runId).toBe(1);

        await controller.continue();
        const secondState = controller.getState();
        expect(secondState.posts.map((post) => String(post.post_id))).toEqual(['1', '2']);
        expect(secondState.runId).toBe(1);
        expect(queryPage).toHaveBeenCalledTimes(2);
        expect(queryPage.mock.calls[1]?.[0]?.cursor).toBe('next');
    });

    it('should detect date boundary using sanitized createdAt fallback', async () => {
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
                stopCapture: mock(async () => {}),
            },
            downloadClient: {
                downloadTextAsFile: mock(async () => ({ ok: true })),
            },
            loadCalibration: mock(async () => makeReadyArtifact()),
            queryPage: mock(async () => {
                const nowMs = Date.now();
                return {
                    nextCursor: 'next',
                    posts: [
                        { content: 'recent', createdAt: nowMs, post_id: 'recent' },
                        { content: 'old', createdAt: Math.floor((nowMs - 10 * 24 * 60 * 60 * 1000) / 1000), post_id: 'old' },
                    ],
                };
            }),
            saveCalibration: mock(async () => {}),
        });

        controller.updateSettings({
            fetchingCountByPostDaysValue: 3,
            fetchingCountType: FETCH_MODE.BY_DAYS_COUNT,
            isUsePostsFilter: true,
        });

        await controller.start();
        const state = controller.getState();
        expect(state.posts.map((post) => String(post.post_id))).toEqual(['recent']);
        expect(state.logs.some((entry) => entry.msg.includes('stop: reached date boundary'))).toBe(true);
    });

    it('should throw when captured calibration artifact is invalid', async () => {
        const controller = new RunController({
            calibrationClient: {
                buildArtifact: mock(async () => ({ bad: true })),
                getStatus: mock(async () => ({
                    active: true,
                    captureCount: 1,
                    capturedNames: ['ProfileCometTimelineFeedRefetchQuery'],
                    missing: [],
                    unmatchedNames: [],
                })),
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

        await expect(controller.saveCalibrationFromCapture()).rejects.toThrow('invalid artifact payload');
    });

    it('should not start a second calibration automation task while one is running', async () => {
        const startCapture = mock(async () => {});
        let resolveAuto: (() => void) | null = null;
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
                startCapture,
                stopCapture: mock(async () => {}),
            },
            downloadClient: {
                downloadTextAsFile: mock(async () => ({ ok: true })),
            },
            loadCalibration: mock(async () => null),
            queryPage: mock(async () => ({ nextCursor: null, posts: [] })),
            saveCalibration: mock(async () => {}),
        });

        (controller as any).runCalibrationAutomation = mock(
            async () =>
                await new Promise<void>((resolve) => {
                    resolveAuto = resolve;
                }),
        );

        await controller.startCalibrationCapture();
        await controller.startCalibrationCapture();
        expect((controller as any).runCalibrationAutomation).toHaveBeenCalledTimes(1);
        expect(startCapture).toHaveBeenCalledTimes(2);
        resolveAuto?.();
        await (controller as any).calibrationAutoTask;
    });

    it('should mark calibration missing when stop capture is called', async () => {
        const stopCapture = mock(async () => {});
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
            saveCalibration: mock(async () => {}),
        });

        await controller.stopCalibrationCapture();
        expect(stopCapture).toHaveBeenCalledTimes(1);
        expect(controller.getState().calibrationStatus).toBe('missing');
    });
});
