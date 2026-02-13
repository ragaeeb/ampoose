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
        expect(states.at(-1)?.open).toBeTrue();

        controller.updateSettings({ isUsePostsFilter: true });
        expect(states.at(-1)?.settings?.isUsePostsFilter).toBeTrue();

        unsubscribe();
        controller.setOpen(false);
        expect(states.at(-1)?.open).toBeTrue();
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
        expect(state.isStopManually).toBeTrue();
        expect(state.logs.some((entry) => entry.msg.includes('run: stopped manually'))).toBeTrue();
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
        expect(controller.getState().logs.some((entry) => entry.type === 'warn')).toBeTrue();
    });

    it('should run calibration automation quickly when a post link is present', async () => {
        const saveCalibration = mock(async () => {});
        const stopCapture = mock(async () => {});

        document.body.innerHTML = "<a href='https://www.facebook.com/permalink.php?story_fbid=123&fbid=123'>post</a>";

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
                        {
                            content: 'old-boundary',
                            createdAt: Math.floor((nowMs - 8 * 24 * 60 * 60 * 1000) / 1000),
                            post_id: 'old-boundary',
                        },
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
                        {
                            content: 'old',
                            createdAt: Math.floor((nowMs - 10 * 24 * 60 * 60 * 1000) / 1000),
                            post_id: 'old',
                        },
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
        expect(state.logs.some((entry) => entry.msg.includes('stop: reason=date-boundary'))).toBeTrue();
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
        if (resolveAuto) {
            (resolveAuto as unknown as () => void)();
        }
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

    it('should apply inter-page request delay between fetches', async () => {
        const queryPage = mock(async ({ cursor }: { cursor: string | null }) => {
            if (!cursor) {
                return {
                    nextCursor: 'next',
                    posts: [{ content: 'p1', post_id: '1' }],
                };
            }
            return {
                nextCursor: null,
                posts: [{ content: 'p2', post_id: '2' }],
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

        const sleepCalls: number[] = [];
        (controller as any).sleep = async (ms: number) => {
            sleepCalls.push(ms);
        };
        controller.updateSettings({ requestDelay: 250 });
        await controller.start();

        expect(queryPage).toHaveBeenCalledTimes(2);
        expect(sleepCalls).toContain(250);
    });

    it('should apply anti-rate-limit pacing jitter and log the wait reason', async () => {
        let page = 0;
        const queryPage = mock(async () => {
            page += 1;
            return {
                nextCursor: page < 4 ? `next-${page}` : null,
                posts: [{ content: `p${page}`, post_id: String(page) }],
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

        const sleepCalls: number[] = [];
        (controller as any).sleep = async (ms: number) => {
            sleepCalls.push(ms);
        };

        const originalRandom = Math.random;
        (Math as any).random = () => 1;
        try {
            controller.updateSettings({ requestDelay: 250 });
            await controller.start();
        } finally {
            (Math as any).random = originalRandom;
        }

        const logs = controller.getState().logs.map((entry) => entry.msg);
        expect(queryPage).toHaveBeenCalledTimes(4);
        expect(sleepCalls.some((value) => value === 250)).toBeTrue();
        expect(sleepCalls.some((value) => value >= 1000)).toBeTrue();
        expect(logs.some((msg) => msg.includes('rate-limit: pacing wait='))).toBeTrue();
        expect(logs.some((msg) => msg.includes('avoid account restrictions'))).toBeTrue();
    });

    it('should log start settings and explicit no-next-cursor stop reason', async () => {
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
            queryPage: mock(async () => ({ nextCursor: null, posts: [{ content: 'p1', post_id: '1' }] })),
            saveCalibration: mock(async () => {}),
        });

        controller.updateSettings({ fetchingCountType: FETCH_MODE.ALL, isUsePostsFilter: false, logLevel: 'debug' });
        await controller.start();

        const logs = controller.getState().logs.map((entry) => entry.msg);
        expect(logs.some((msg) => msg.includes('run: start') && msg.includes('mode=ALL'))).toBeTrue();
        expect(logs.some((msg) => msg.includes('stop: reason=no-next-cursor'))).toBeTrue();
        expect(logs.some((msg) => msg.includes('run: done reason=no-next-cursor'))).toBeTrue();
    });

    it('should resume from imported post payloads by skipping known IDs first', async () => {
        let page = 0;
        const queryPage = mock(async () => {
            page += 1;
            if (page <= 6) {
                return {
                    nextCursor: `cursor-${page}`,
                    posts: [{ content: 'known post', post_id: 'known-1' }],
                };
            }
            return {
                nextCursor: null,
                posts: [{ content: 'new older post', post_id: 'new-1' }],
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
            fetchingCountType: FETCH_MODE.ALL,
            isUsePostsFilter: false,
            requestDelay: 0,
        });

        await (controller as any).resumeFromImportedPayloads([
            [{ content: 'known post', createdAt: 1_750_000_000, id: 'known-1' }],
        ]);

        const state = controller.getState();
        const logs = state.logs.map((entry) => entry.msg);
        expect(queryPage).toHaveBeenCalledTimes(7);
        expect(state.posts.some((post) => post.post_id === 'new-1')).toBeTrue();
        expect(logs.some((msg) => msg.includes('resume: imported known post ids=1'))).toBeTrue();
        expect(logs.some((msg) => msg.includes('resume: warmup complete'))).toBeTrue();
        expect(logs.some((msg) => msg.includes('stop: reason=duplicate-loop'))).toBeFalse();
    });

    it('should keep resume warmup active until first exportable post even when non-text pages repeat', async () => {
        let page = 0;
        const queryPage = mock(async () => {
            page += 1;
            if (page === 1) {
                return {
                    nextCursor: 'loop-cursor',
                    posts: [{ content: '   ', post_id: 'nontext-1' }],
                };
            }
            if (page <= 7) {
                return {
                    nextCursor: 'loop-cursor',
                    posts: [{ content: '   ', post_id: 'nontext-1' }],
                };
            }
            return {
                nextCursor: null,
                posts: [{ content: 'new exportable post', post_id: 'new-1' }],
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

        controller.updateSettings({ fetchingCountType: FETCH_MODE.ALL, isUsePostsFilter: false, requestDelay: 0 });
        await (controller as any).resumeFromImportedPayloads([[{ content: 'known', createdAt: 1, id: 'known-1' }]]);

        const state = controller.getState();
        const logs = state.logs.map((entry) => entry.msg);
        expect(queryPage).toHaveBeenCalledTimes(8);
        expect(state.posts.some((post) => post.post_id === 'new-1')).toBeTrue();
        expect(logs.some((msg) => msg.includes('stop: reason=duplicate-loop'))).toBeFalse();
        expect(logs.some((msg) => msg.includes('resume: warmup complete'))).toBeTrue();
    });

    it('should truncate cursor values in runtime logs', async () => {
        const longCursor = 'x'.repeat(160);
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
            queryPage: mock(async () => ({ nextCursor: null, posts: [] })),
            saveCalibration: mock(async () => {}),
        });

        await controller.start({ cursor: longCursor });

        const startLog = controller.getState().logs.find((entry) => entry.msg.includes('run: start'));
        expect(startLog?.msg.includes('(len=160)')).toBeTrue();
        expect(startLog?.msg.includes(`${'x'.repeat(160)}`)).toBeFalse();
    });

    it('should log recalibration hint for graphql retry failures', async () => {
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
                throw new Error(
                    'GraphQL request failed after retries. endpoint=/api/graphql/ params=19 error=GraphQL request failed: 500',
                );
            }),
            saveCalibration: mock(async () => {}),
        });

        await expect(controller.start()).rejects.toThrow('GraphQL request failed after retries');
        const logs = controller.getState().logs.map((entry) => entry.msg);
        expect(logs.some((msg) => msg.includes('calibration/session may be stale'))).toBeTrue();
    });

    it('should download redacted json with trimmed content', async () => {
        let payload = '';
        let filename = '';
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
                downloadTextAsFile: mock(async (data, targetFilename) => {
                    payload = data;
                    filename = targetFilename;
                    return { ok: true };
                }),
            },
            getCurrentUrl: () => 'https://www.facebook.com/some.username',
            loadCalibration: mock(async () => makeReadyArtifact()),
            queryPage: mock(async () => ({
                nextCursor: null,
                posts: [{ content: 'x'.repeat(200), post_id: 'p1' }],
            })),
            saveCalibration: mock(async () => {}),
        });

        await controller.start();
        await controller.downloadJsonRedacted();

        expect(filename).toBe('some.username/posts-redacted.json');
        const parsed = JSON.parse(payload) as { posts: Array<{ content: string; contentLength: number }> };
        expect(parsed.posts[0]?.contentLength).toBe(200);
        expect((parsed.posts[0]?.content ?? '').length).toBeLessThan(200);
    });

    it('should log earliest visible post from current run', async () => {
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
            queryPage: mock(async () => ({
                nextCursor: null,
                posts: [
                    { content: 'newer', createdAt: 1752124842, post_id: '1784503595771704' },
                    { content: 'older', createdAt: 1751689562, post_id: '1780554499499947' },
                ],
            })),
            saveCalibration: mock(async () => {}),
        });

        await controller.start();
        controller.logEarliestVisiblePost();
        const logs = controller.getState().logs.map((entry) => entry.msg);
        expect(logs.some((msg) => msg.includes('probe: earliest-visible-post id=1780554499499947'))).toBeTrue();
    });

    it('should probe earliest accessible post by paginating without downloads', async () => {
        const queryPage = mock(async ({ cursor }: { cursor: string | null }) => {
            if (!cursor) {
                return {
                    nextCursor: 'next',
                    posts: [{ content: 'newer', createdAt: 1752124842, post_id: '1784503595771704' }],
                };
            }
            return {
                nextCursor: null,
                posts: [{ content: 'older', createdAt: 1751689562, post_id: '1780554499499947' }],
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

        await controller.probeEarliestAccessiblePost();
        const logs = controller.getState().logs.map((entry) => entry.msg);
        expect(logs.some((msg) => msg.includes('probe: earliest-accessible-post id=1780554499499947'))).toBeTrue();
        expect(queryPage).toHaveBeenCalledTimes(2);
    });

    it('should stop an active probe when stopProbe is called', async () => {
        const queryPage = mock(async ({ signal }: { signal: AbortSignal }) => {
            return await new Promise<{ nextCursor: string | null; posts: Array<Record<string, unknown>> }>(
                (_resolve, reject) => {
                    if (signal.aborted) {
                        reject(new Error('aborted'));
                        return;
                    }
                    signal.addEventListener('abort', () => reject(new Error('aborted')));
                },
            );
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

        const probing = controller.probeEarliestAccessiblePost();
        controller.stopProbe();
        await probing;

        const logs = controller.getState().logs.map((entry) => entry.msg);
        expect(logs.some((msg) => msg.includes('probe: stop requested'))).toBeTrue();
        expect(logs.some((msg) => msg.includes('probe: stop manual'))).toBeTrue();
    });

    it('should treat abort during manual stop as non-fatal and avoid run failed error log', async () => {
        let enteredQuery: (() => void) | null = null;
        const queryEntered = new Promise<void>((resolve) => {
            enteredQuery = resolve;
        });
        const queryPage = mock(async ({ signal }: { signal: AbortSignal }) => {
            enteredQuery?.();
            return await new Promise<{ nextCursor: string | null; posts: Array<Record<string, unknown>> }>(
                (_resolve, reject) => {
                    if (signal.aborted) {
                        reject(
                            new Error(
                                'GraphQL request failed after retries. endpoint=/api/graphql/ params=23 error=Calibration action aborted: graphqlFetch',
                            ),
                        );
                        return;
                    }
                    signal.addEventListener(
                        'abort',
                        () =>
                            reject(
                                new Error(
                                    'GraphQL request failed after retries. endpoint=/api/graphql/ params=23 error=Calibration action aborted: graphqlFetch',
                                ),
                            ),
                        { once: true },
                    );
                },
            );
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

        const running = controller.start();
        await queryEntered;
        controller.stop();
        await running;

        const state = controller.getState();
        const logs = state.logs.map((entry) => entry.msg);
        expect(state.error).toBeNull();
        expect(logs.some((msg) => msg.includes('run: failed reason=error'))).toBeFalse();
        expect(logs.some((msg) => msg.includes('stop: reason=manual-stop'))).toBeTrue();
    });

    it('should log explicit empty-page debug message instead of null window values', async () => {
        const queryPage = mock(async ({ cursor }: { cursor: string | null }) => {
            if (!cursor) {
                return { nextCursor: 'next', posts: [] };
            }
            return { nextCursor: null, posts: [{ content: 'hello', post_id: '1' }] };
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

        controller.updateSettings({ logLevel: 'debug', requestDelay: 0 });
        await controller.start();

        const logs = controller.getState().logs.map((entry) => entry.msg);
        expect(logs.some((msg) => msg.includes('[debug] page(empty): fetched=0 deduped=0'))).toBeTrue();
        expect(
            logs.some((msg) =>
                msg.includes('[debug] page(filter): valid=0 filtered=0 boundaryReached=false cutoffMs=0'),
            ),
        ).toBeFalse();
        expect(
            logs.some((msg) =>
                msg.includes('[debug] page(window): firstId=null lastId=null firstCreatedAt=0 lastCreatedAt=0'),
            ),
        ).toBeFalse();
    });
});
