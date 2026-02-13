import { expect, it } from 'bun:test';
import { buildGraphqlArtifact } from '@/domain/calibration/artifact';
import { RunController } from '@/runtime/controller/runController';
import { FETCH_MODE } from '@/runtime/settings/types';

const createReadyArtifact = () => {
    return buildGraphqlArtifact({
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
            variables: { id: '100026362418520', scale: 2 },
        },
    });
};

const createCalibrationClient = () => {
    return {
        buildArtifact: async () => createReadyArtifact(),
        getStatus: async () => ({ active: false, captureCount: 0, missing: [] as string[] }),
        startCapture: async () => {},
        stopCapture: async () => {},
    };
};

it('should block start when calibration missing', async () => {
    const controller = new RunController({
        calibrationClient: createCalibrationClient(),
        downloadClient: {
            downloadTextAsFile: async () => ({ ok: true }),
        },
        getCurrentUrl: () => 'https://www.facebook.com/some.username',
        loadCalibration: async () => null,
        queryPage: async () => ({ nextCursor: null, posts: [] }),
        saveCalibration: async () => {},
    });

    await expect(controller.start()).rejects.toThrow('DocId calibration required before export.');
});

it('should export direct posts.json when no chunk output', async () => {
    const downloads: Array<{ filename: string; data: string }> = [];

    const controller = new RunController({
        calibrationClient: createCalibrationClient(),
        downloadClient: {
            downloadTextAsFile: async (data, filename) => {
                downloads.push({ data, filename });
                return { ok: true };
            },
        },
        getCurrentUrl: () => 'https://www.facebook.com/some.username',
        loadCalibration: async () => createReadyArtifact(),
        queryPage: async ({ cursor }) => {
            if (cursor) {
                return { nextCursor: null, posts: [] };
            }
            return {
                nextCursor: null,
                posts: [
                    {
                        author: { id: 'a1', name: 'Author', profile: 'https://www.facebook.com/author' },
                        content: 'hello',
                        post_id: 'p1',
                    },
                ],
            };
        },
        saveCalibration: async () => {},
    });

    controller.updateSettings({ fetchingCountByPostCountValue: 10, fetchingCountType: FETCH_MODE.BY_POST_COUNT });
    await controller.start();
    await controller.downloadJson();

    expect(downloads.length).toBe(1);
    expect(downloads[0]?.filename).toBe('some.username/posts.json');
    const payload = JSON.parse(downloads[0]!.data) as { posts: Array<{ id: string; content: string }> };
    expect(payload.posts).toEqual([{ content: 'hello', id: 'p1' }]);
});

it('should emit chunk files and index in ALL mode', async () => {
    const downloads = new Map<string, string>();

    const controller = new RunController({
        calibrationClient: createCalibrationClient(),
        downloadClient: {
            downloadTextAsFile: async (data, filename) => {
                downloads.set(filename, data);
                return { ok: true };
            },
        },
        getCurrentUrl: () => 'https://www.facebook.com/permalink.php?story_fbid=1',
        loadCalibration: async () => createReadyArtifact(),
        queryPage: async ({ cursor }) => {
            if (cursor) {
                return { nextCursor: null, posts: [] };
            }
            return {
                nextCursor: null,
                posts: Array.from({ length: 550 }).map((_, i) => ({ content: `post ${i}`, post_id: `p-${i}` })),
            };
        },
        saveCalibration: async () => {},
    });

    controller.updateSettings({ fetchingCountType: FETCH_MODE.ALL, isUsePostsFilter: false });
    await controller.start();
    await controller.downloadJson();

    expect(downloads.has('100026362418520/posts-run-000001-part-0001.json')).toBe(true);
    expect(downloads.has('100026362418520/posts-run-000001-part-0002.json')).toBe(true);
    expect(downloads.has('100026362418520/posts-run-000001-index.json')).toBe(true);
    const indexPayload = JSON.parse(downloads.get('100026362418520/posts-run-000001-index.json') ?? '{}') as {
        collectionId: string;
        folderNames: string[];
    };
    expect(indexPayload.collectionId).toBe('100026362418520');
    expect(indexPayload.folderNames).toEqual(['100026362418520']);
});

it('should log capture diagnostics when calibration entries are missing', async () => {
    const controller = new RunController({
        calibrationClient: {
            buildArtifact: async () => createReadyArtifact(),
            getStatus: async () => ({
                active: true,
                captureCount: 1,
                capturedNames: ['ProfileCometTimelineFeedRefetchQuery'],
                missing: ['CometSinglePostDialogContentQuery'],
            }),
            startCapture: async () => {},
            stopCapture: async () => {},
        },
        downloadClient: {
            downloadTextAsFile: async () => ({ ok: true }),
        },
        getCurrentUrl: () => 'https://www.facebook.com/some.username',
        loadCalibration: async () => null,
        queryPage: async () => ({ nextCursor: null, posts: [] }),
        saveCalibration: async () => {},
    });

    await controller.saveCalibrationFromCapture();

    const warnings = controller
        .getState()
        .logs.filter((entry) => entry.type === 'warn')
        .map((entry) => entry.msg);
    expect(
        warnings.some(
            (msg) =>
                msg.includes('missing entries CometSinglePostDialogContentQuery') &&
                msg.includes('captured=ProfileCometTimelineFeedRefetchQuery') &&
                msg.includes('count=1'),
        ),
    ).toBe(true);
});

it('should download logs file in collection folder', async () => {
    const downloads: string[] = [];
    const controller = new RunController({
        calibrationClient: createCalibrationClient(),
        downloadClient: {
            downloadTextAsFile: async (_data, filename) => {
                downloads.push(filename);
                return { ok: true };
            },
        },
        getCurrentUrl: () => 'https://www.facebook.com/some.username',
        loadCalibration: async () => createReadyArtifact(),
        queryPage: async () => ({ nextCursor: null, posts: [] }),
        saveCalibration: async () => {},
    });

    await controller.loadCalibrationStatus();
    controller.addLog('info', 'run: start');
    await controller.downloadLogsJson();

    expect(downloads.length).toBe(1);
    expect(downloads[0]!.startsWith('some.username/logs-')).toBe(true);
    expect(downloads[0]!.endsWith('.json')).toBe(true);
});

it('should filter posts by date in BY_DAYS_COUNT mode and stop when boundary is reached', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    let queryCalls = 0;

    const controller = new RunController({
        calibrationClient: createCalibrationClient(),
        downloadClient: {
            downloadTextAsFile: async () => ({ ok: true }),
        },
        getCurrentUrl: () => 'https://www.facebook.com/some.username',
        loadCalibration: async () => createReadyArtifact(),
        queryPage: async ({ cursor }) => {
            queryCalls += 1;

            if (cursor) {
                return {
                    nextCursor: null,
                    posts: [
                        { content: 'older page post', createdAt: nowSec - 20 * 24 * 60 * 60, post_id: 'older-page' },
                    ],
                };
            }

            return {
                nextCursor: 'next',
                posts: [
                    { content: 'recent post', createdAt: nowSec - 2 * 60 * 60, post_id: 'recent' },
                    { content: 'old post', createdAt: nowSec - 9 * 24 * 60 * 60, post_id: 'old' },
                ],
            };
        },
        saveCalibration: async () => {},
    });

    controller.updateSettings({
        fetchingCountByPostDaysValue: 3,
        fetchingCountType: FETCH_MODE.BY_DAYS_COUNT,
    });

    await controller.start();

    const postIds = controller.getState().posts.map((post) => String(post.post_id ?? ''));
    expect(postIds).toEqual(['recent']);
    expect(queryCalls).toBe(1);
});

it('should dedupe posts across chunk boundaries in ALL mode', async () => {
    const downloads = new Map<string, string>();

    const controller = new RunController({
        calibrationClient: createCalibrationClient(),
        downloadClient: {
            downloadTextAsFile: async (data, filename) => {
                downloads.set(filename, data);
                return { ok: true };
            },
        },
        getCurrentUrl: () => 'https://www.facebook.com/permalink.php?story_fbid=1',
        loadCalibration: async () => createReadyArtifact(),
        queryPage: async ({ cursor }) => {
            if (!cursor) {
                return {
                    nextCursor: 'next',
                    posts: Array.from({ length: 500 }).map((_, i) => ({ content: `post ${i}`, post_id: `p-${i}` })),
                };
            }

            return {
                nextCursor: null,
                posts: Array.from({ length: 500 }).map((_, i) => ({
                    content: `post ${i + 250}`,
                    post_id: `p-${i + 250}`,
                })),
            };
        },
        saveCalibration: async () => {},
    });

    controller.updateSettings({ fetchingCountType: FETCH_MODE.ALL, isUsePostsFilter: false });

    await controller.start();
    await controller.downloadJson();

    const part1 = JSON.parse(downloads.get('100026362418520/posts-run-000001-part-0001.json') ?? '[]') as Array<{
        id: string;
    }>;
    const part2 = JSON.parse(downloads.get('100026362418520/posts-run-000001-part-0002.json') ?? '[]') as Array<{
        id: string;
    }>;

    expect(part1.length).toBe(500);
    expect(part2.length).toBe(250);

    const ids = new Set(part1.map((post) => post.id));
    expect(part2.some((post) => ids.has(post.id))).toBe(false);
});
