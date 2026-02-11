import {
  type BridgeAction,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeResponsePayloadMap
} from "@/runtime/bridge/actions";

const UI_SETTINGS_KEY = "fbpem-ui-settings";
const PERSIST_KEY = "fbpem-persist";
const RESUME_KEY = "fbpem-resume-cursors";
const DOWNLOAD_ROOT = "Ampoose";

export function buildDownloadFilename(filename: string | undefined): string {
  const raw = String(filename ?? "posts.json").trim() || "posts.json";
  const normalizedSlash = raw.replace(/\\/g, "/");
  const withoutPrefix = normalizedSlash.replace(/^Ampoose\/+/i, "");
  const segments = withoutPrefix
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..");
  const leaf = segments.length > 0 ? segments.join("/") : "posts.json";
  return `${DOWNLOAD_ROOT}/${leaf}`;
}

async function getStorage<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get([key]);
  if (Object.prototype.hasOwnProperty.call(result, key)) {
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
    (await getStorage<Record<string, Record<string, { cursor: string; timestamp: number }>>>(
      RESUME_KEY,
      {}
    )) ?? {}
  );
}

async function setResumeStore(
  store: Record<string, Record<string, { cursor: string; timestamp: number }>>
): Promise<void> {
  await setStorage(RESUME_KEY, store);
}

export async function ensureCspRules(): Promise<void> {
  const rules: chrome.declarativeNetRequest.Rule[] = [
    {
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "Content-Security-Policy", operation: "remove" },
          { header: "Content-Security-Policy-Report-Only", operation: "remove" }
        ]
      },
      condition: {
        regexFilter: "https?://(www\\.|web\\.)?facebook\\.com/.*",
        resourceTypes: ["main_frame", "xmlhttprequest"]
      }
    }
  ];

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((rule) => rule.id);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: rules
  });
}

async function downloadTextAsFile(
  text: string,
  filename: string,
  mimeType = "application/json",
  useDataUrl = false
): Promise<{ ok: boolean; method?: "blob" | "data"; id?: number; error?: string }> {
  const safeFilename = buildDownloadFilename(filename || "posts.json");
  const data = typeof text === "string" ? text : String(text ?? "");

  try {
    if (!useDataUrl) {
      const blob = new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const id = await chrome.downloads.download({
        url,
        filename: safeFilename,
        saveAs: false,
        conflictAction: "uniquify"
      });
      URL.revokeObjectURL(url);
      return { ok: true, method: "blob", id };
    }
  } catch {
    // fallback below
  }

  try {
    const base64 = btoa(unescape(encodeURIComponent(data)));
    const url = `data:${mimeType};base64,${base64}`;
    const id = await chrome.downloads.download({
      url,
      filename: safeFilename,
      saveAs: false,
      conflictAction: "uniquify"
    });
    return { ok: true, method: "data", id };
  } catch (error) {
    return {
      ok: false,
      error: String(error instanceof Error ? error.message : error)
    };
  }
}

export async function handleBridgeMessage<A extends BridgeAction>(
  request: BridgeRequest<A>
): Promise<BridgeResponse<A> | undefined> {
  const payload = Array.isArray(request.payload) ? request.payload : [];

  switch (request.action) {
    case "getUIMemoSettings": {
      const settings = await getStorage<Record<string, unknown> | null>(UI_SETTINGS_KEY, null);
      return settings as BridgeResponse<A>;
    }
    case "setUIMemoSettings": {
      await setStorage(UI_SETTINGS_KEY, payload[0] ?? null);
      return true as BridgeResponse<A>;
    }
    case "getPersistLocalStorage": {
      const key = payload[0] as string;
      const fallback = payload[1];
      const store = await getPersistStore();
      if (!key) return (fallback ?? null) as BridgeResponse<A>;
      if (!(key in store)) return (fallback ?? null) as BridgeResponse<A>;
      return store[key] as BridgeResponse<A>;
    }
    case "setPersistLocalStorage": {
      const key = payload[0] as string;
      const value = payload[1];
      const store = await getPersistStore();
      if (key) {
        store[key] = value;
        await setPersistStore(store);
      }
      return true as BridgeResponse<A>;
    }
    case "removePersistLocalStorage": {
      const key = payload[0] as string;
      const store = await getPersistStore();
      if (key in store) {
        delete store[key];
        await setPersistStore(store);
      }
      return true as BridgeResponse<A>;
    }
    case "clearPersistLocalStorage": {
      await setPersistStore({});
      return true as BridgeResponse<A>;
    }
    case "getAllPersistLocalStorage": {
      return (await getPersistStore()) as BridgeResponse<A>;
    }
    case "getResumeCursors": {
      const collectionId = payload[0] as string;
      const store = await getResumeStore();
      return ((collectionId && store[collectionId]) || {}) as BridgeResponse<A>;
    }
    case "setResumeCursors": {
      const collectionId = payload[0] as string;
      const cursorId = payload[1] as string;
      const cursor = payload[2] as string;
      if (!collectionId || !cursorId || !cursor) return false as BridgeResponse<A>;
      const store = await getResumeStore();
      store[collectionId] = store[collectionId] || {};
      store[collectionId][cursorId] = {
        cursor,
        timestamp: Date.now()
      };
      await setResumeStore(store);
      return true as BridgeResponse<A>;
    }
    case "removeResumeCursors": {
      const collectionId = payload[0] as string;
      const cursorId = payload[1] as string;
      const store = await getResumeStore();
      if (store[collectionId] && cursorId in store[collectionId]) {
        delete store[collectionId][cursorId];
        await setResumeStore(store);
      }
      return true as BridgeResponse<A>;
    }
    case "downloadTextAsFile": {
      const text = String(payload[0] ?? "");
      const filename = String(payload[1] ?? "posts.json");
      const mimeType = typeof payload[2] === "string" ? payload[2] : "application/json";
      const useDataUrl = Boolean(payload[3]);
      return (await downloadTextAsFile(text, filename, mimeType, useDataUrl)) as BridgeResponse<A>;
    }
    case "downloadFileByUri": {
      const url = String(payload[0] ?? "");
      const filename = typeof payload[1] === "string" ? payload[1] : undefined;
      if (!url) {
        return {
          ok: false,
          error: "missing url"
        } as BridgeResponse<A>;
      }
      try {
        const id = await chrome.downloads.download({
          url,
          filename: buildDownloadFilename(filename),
          saveAs: false,
          conflictAction: "uniquify"
        });
        return { ok: true, id } as BridgeResponse<A>;
      } catch (error) {
        return {
          ok: false,
          error: String(error instanceof Error ? error.message : error)
        } as BridgeResponse<A>;
      }
    }
    default:
      return undefined;
  }
}

export function registerBackgroundListeners() {
  chrome.runtime.onInstalled.addListener(() => {
    void ensureCspRules();
  });

  chrome.runtime.onStartup.addListener(() => {
    void ensureCspRules();
  });

  chrome.runtime.onMessage.addListener((message: BridgeRequest, _sender, sendResponse) => {
    void Promise.resolve(handleBridgeMessage(message))
      .then((result) => sendResponse(result as BridgeResponsePayloadMap[BridgeAction]))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: String(error instanceof Error ? error.message : error)
        });
      });
    return true;
  });
}
