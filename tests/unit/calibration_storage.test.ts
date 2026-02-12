import { afterEach, describe, expect, it, mock } from 'bun:test';
import { CALIBRATION_STORAGE_KEY } from '@/domain/calibration/artifact';
import { clearCalibrationArtifact, loadCalibrationArtifact, saveCalibrationArtifact } from '@/runtime/calibration/storage';

describe('calibration storage', () => {
    const originalChrome = (globalThis as any).chrome;

    afterEach(() => {
        (globalThis as any).chrome = originalChrome;
    });

    it('should load and normalize the stored artifact', async () => {
        const sendMessage = mock(async ({ action }: any) => {
            if (action === 'getPersistLocalStorage') {
                return {
                    schemaVersion: 1,
                    entries: {
                        ProfileCometTimelineFeedRefetchQuery: {
                            docId: '123',
                            preload: [],
                            queryName: 'ProfileCometTimelineFeedRefetchQuery',
                            variables: { id: '456' },
                        },
                    },
                };
            }
            return null;
        });

        (globalThis as any).chrome = {
            ...(originalChrome ?? {}),
            runtime: {
                ...(originalChrome?.runtime ?? {}),
                sendMessage,
            },
        };

        const artifact = await loadCalibrationArtifact();

        expect(sendMessage).toHaveBeenCalledWith({
            action: 'getPersistLocalStorage',
            payload: [CALIBRATION_STORAGE_KEY, null],
        });
        expect(artifact?.entries.ProfileCometTimelineFeedRefetchQuery?.docId).toBe('123');
    });

    it('should save and clear the stored artifact', async () => {
        const sendMessage = mock(async () => true);
        (globalThis as any).chrome = {
            ...(originalChrome ?? {}),
            runtime: {
                ...(originalChrome?.runtime ?? {}),
                sendMessage,
            },
        };

        const artifact: any = {
            schemaVersion: 1,
            updatedAt: new Date().toISOString(),
            entries: {},
            names: [],
            count: 0,
        };

        await saveCalibrationArtifact(artifact);
        expect(sendMessage).toHaveBeenCalledWith({
            action: 'setPersistLocalStorage',
            payload: [CALIBRATION_STORAGE_KEY, artifact],
        });

        await clearCalibrationArtifact();
        expect(sendMessage).toHaveBeenCalledWith({
            action: 'removePersistLocalStorage',
            payload: [CALIBRATION_STORAGE_KEY],
        });
    });
});
