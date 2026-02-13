import type { RuntimeLogLevel } from '@/runtime/settings/types';

const LOG_LEVEL_STORAGE_KEY = 'ampoose.logLevel';
const LOG_LEVELS: RuntimeLogLevel[] = ['error', 'warn', 'info', 'debug'];

function isRuntimeLogLevel(value: unknown): value is RuntimeLogLevel {
    return typeof value === 'string' && LOG_LEVELS.includes(value as RuntimeLogLevel);
}

export async function loadStoredLogLevel(defaultLevel: RuntimeLogLevel = 'info'): Promise<RuntimeLogLevel> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) {
        return defaultLevel;
    }
    const result = await chrome.storage.local.get(LOG_LEVEL_STORAGE_KEY);
    const value = result?.[LOG_LEVEL_STORAGE_KEY];
    return isRuntimeLogLevel(value) ? value : defaultLevel;
}

export async function saveStoredLogLevel(level: RuntimeLogLevel): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.set) {
        return;
    }
    await chrome.storage.local.set({ [LOG_LEVEL_STORAGE_KEY]: level });
}

export function observeStoredLogLevel(onChange: (level: RuntimeLogLevel) => void): () => void {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged?.addListener) {
        return () => {};
    }

    const listener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, areaName) => {
        if (areaName !== 'local') {
            return;
        }
        const next = changes?.[LOG_LEVEL_STORAGE_KEY]?.newValue;
        if (isRuntimeLogLevel(next)) {
            onChange(next);
        }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
}

export const runtimeLogLevels = LOG_LEVELS;
