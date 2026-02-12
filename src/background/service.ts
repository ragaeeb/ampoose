import type { BridgeAction, BridgeRequest, BridgeResponse, BridgeResponsePayloadMap } from '@/runtime/bridge/actions';
import { buildDownloadFilename } from '@/background/downloadPath';

const UI_SETTINGS_KEY = 'fbpem-ui-settings';
const PERSIST_KEY = 'fbpem-persist';
const RESUME_KEY = 'fbpem-resume-cursors';
export { buildDownloadFilename };

async function getStorage<T>(key: string, fallback: T): Promise<T> {
    const result = await chrome.storage.local.get([key]);
    if (Object.hasOwn(result, key)) {
        return result[key] as T;
    }
    return fallback;
}

async function setStorage<T>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
}

async function getPersistStore(): Promise<Record<string, unknown>> {
    return (await getStorage<Record<string, unknown>>(PERSIST_KEY, {})) ?? {};
}

async function setPersistStore(store: Record<string, unknown>): Promise<void> {
    await setStorage(PERSIST_KEY, store);
}

async function getResumeStore(): Promise<Record<string, Record<string, { cursor: string; timestamp: number }>>> {
    return (
        (await getStorage<Record<string, Record<string, { cursor: string; timestamp: number }>>>(RESUME_KEY, {})) ?? {}
    );
}

async function setResumeStore(
    store: Record<string, Record<string, { cursor: string; timestamp: number }>>,
): Promise<void> {
    await setStorage(RESUME_KEY, store);
}

function payloadToString(value: unknown): string {
    return typeof value === 'string' ? value : String(value ?? '');
}

function payloadToOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

async function downloadTextAsFile(
    text: string,
    filename: string,
    mimeType = 'application/json',
    useDataUrl = false,
): Promise<{ ok: boolean; method?: 'blob' | 'data'; id?: number; error?: string }> {
    const safeFilename = buildDownloadFilename(filename || 'posts.json');
    const data = typeof text === 'string' ? text : String(text ?? '');

    try {
        if (!useDataUrl) {
            const blob = new Blob([data], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const id = await chrome.downloads.download({
                conflictAction: 'uniquify',
                filename: safeFilename,
                saveAs: false,
                url,
            });
            URL.revokeObjectURL(url);
            return { id, method: 'blob', ok: true };
        }
    } catch {
        // fallback below
    }

    try {
        const base64 = btoa(unescape(encodeURIComponent(data)));
        const url = `data:${mimeType};base64,${base64}`;
        const id = await chrome.downloads.download({
            conflictAction: 'uniquify',
            filename: safeFilename,
            saveAs: false,
            url,
        });
        return { id, method: 'data', ok: true };
    } catch (error) {
        return {
            error: String(error instanceof Error ? error.message : error),
            ok: false,
        };
    }
}

type BridgeHandler = (payload: unknown[]) => Promise<BridgeResponsePayloadMap[BridgeAction]>;

const bridgeHandlers: Record<BridgeAction, BridgeHandler> = {
    clearPersistLocalStorage: async () => {
        await setPersistStore({});
        return true;
    },
    downloadFileByUri: async (payload) => {
        const url = payloadToString(payload[0]);
        const filename = payloadToOptionalString(payload[1]);
        if (!url) {
            return {
                error: 'missing url',
                ok: false,
            };
        }
        try {
            const id = await chrome.downloads.download({
                conflictAction: 'uniquify',
                filename: buildDownloadFilename(filename),
                saveAs: false,
                url,
            });
            return { id, ok: true };
        } catch (error) {
            return {
                error: String(error instanceof Error ? error.message : error),
                ok: false,
            };
        }
    },
    downloadTextAsFile: async (payload) => {
        const text = payloadToString(payload[0]);
        const filename = payloadToString(payload[1] ?? 'posts.json');
        const mimeType = typeof payload[2] === 'string' ? payload[2] : 'application/json';
        const useDataUrl = Boolean(payload[3]);
        return await downloadTextAsFile(text, filename, mimeType, useDataUrl);
    },
    getAllPersistLocalStorage: async () => {
        return await getPersistStore();
    },
    getPersistLocalStorage: async (payload) => {
        const key = payloadToString(payload[0]);
        const fallback = payload[1];
        const store = await getPersistStore();
        if (!key) {
            return fallback ?? null;
        }
        if (!(key in store)) {
            return fallback ?? null;
        }
        return store[key];
    },
    getResumeCursors: async (payload) => {
        const collectionId = payloadToString(payload[0]);
        const store = await getResumeStore();
        return (collectionId && store[collectionId]) || {};
    },
    getUIMemoSettings: async () => {
        return await getStorage<Record<string, unknown> | null>(UI_SETTINGS_KEY, null);
    },
    removePersistLocalStorage: async (payload) => {
        const key = payloadToString(payload[0]);
        const store = await getPersistStore();
        if (key in store) {
            delete store[key];
            await setPersistStore(store);
        }
        return true;
    },
    removeResumeCursors: async (payload) => {
        const collectionId = payloadToString(payload[0]);
        const cursorId = payloadToString(payload[1]);
        const store = await getResumeStore();
        if (store[collectionId] && cursorId in store[collectionId]) {
            delete store[collectionId][cursorId];
            await setResumeStore(store);
        }
        return true;
    },
    setPersistLocalStorage: async (payload) => {
        const key = payloadToString(payload[0]);
        const value = payload[1];
        if (!key) {
            return true;
        }
        const store = await getPersistStore();
        store[key] = value;
        await setPersistStore(store);
        return true;
    },
    setResumeCursors: async (payload) => {
        const collectionId = payloadToString(payload[0]);
        const cursorId = payloadToString(payload[1]);
        const cursor = payloadToString(payload[2]);
        if (!collectionId || !cursorId || !cursor) {
            return false;
        }
        const store = await getResumeStore();
        store[collectionId] = store[collectionId] || {};
        store[collectionId][cursorId] = {
            cursor,
            timestamp: Date.now(),
        };
        await setResumeStore(store);
        return true;
    },
    setUIMemoSettings: async (payload) => {
        await setStorage(UI_SETTINGS_KEY, payload[0] ?? null);
        return true;
    },
};

export async function handleBridgeMessage<A extends BridgeAction>(
    request: BridgeRequest<A>,
): Promise<BridgeResponse<A> | undefined> {
    const payload = Array.isArray(request.payload) ? request.payload : [];
    const handler = bridgeHandlers[request.action as BridgeAction];
    if (!handler) {
        return undefined;
    }
    return (await handler(payload)) as BridgeResponse<A>;
}

export function registerBackgroundListeners() {
    chrome.runtime.onMessage.addListener((message: BridgeRequest, _sender, sendResponse) => {
        void Promise.resolve(handleBridgeMessage(message))
            .then((result) => sendResponse(result as BridgeResponsePayloadMap[BridgeAction]))
            .catch((error) => {
                sendResponse({
                    error: String(error instanceof Error ? error.message : error),
                    ok: false,
                });
            });
        return true;
    });
}
