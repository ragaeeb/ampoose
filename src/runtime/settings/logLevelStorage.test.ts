import { afterEach, describe, expect, it, mock } from 'bun:test';
import { loadStoredLogLevel, observeStoredLogLevel, saveStoredLogLevel } from '@/runtime/settings/logLevelStorage';

describe('log level storage', () => {
    const originalChrome = (globalThis as any).chrome;

    afterEach(() => {
        (globalThis as any).chrome = originalChrome;
    });

    it('should load default log level when storage is unavailable', async () => {
        (globalThis as any).chrome = undefined;
        await expect(loadStoredLogLevel('warn')).resolves.toBe('warn');
    });

    it('should load and save log level from chrome.storage.local', async () => {
        const get = mock(async () => ({ 'ampoose.logLevel': 'debug' }));
        const set = mock(async () => {});
        (globalThis as any).chrome = {
            storage: {
                local: { get, set },
                onChanged: {
                    addListener: mock(() => {}),
                    removeListener: mock(() => {}),
                },
            },
        };

        await expect(loadStoredLogLevel()).resolves.toBe('debug');
        await saveStoredLogLevel('error');
        expect(set).toHaveBeenCalledWith({ 'ampoose.logLevel': 'error' });
    });

    it('should observe log level changes from storage events', () => {
        let listener: any;
        const addListener = mock((fn: any) => {
            listener = fn;
        });
        const removeListener = mock(() => {});
        const onChange = mock(() => {});

        (globalThis as any).chrome = {
            storage: {
                local: {
                    get: mock(async () => ({})),
                    set: mock(async () => {}),
                },
                onChanged: {
                    addListener,
                    removeListener,
                },
            },
        };

        const unsubscribe = observeStoredLogLevel(onChange);
        listener({ 'ampoose.logLevel': { newValue: 'warn' } }, 'local');
        listener({ 'ampoose.logLevel': { newValue: 'invalid' } }, 'local');
        listener({ 'ampoose.logLevel': { newValue: 'debug' } }, 'sync');

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('warn');

        unsubscribe();
        expect(removeListener).toHaveBeenCalledTimes(1);
    });
});
