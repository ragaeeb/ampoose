export type CalibrationBridgeAction = "start" | "stop" | "status" | "buildArtifact" | "graphqlFetch";

type GraphqlFetchPayload = {
  endpoint: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
};

type CalibrationReq = {
  __ampooseCalibrationReq: true;
  id: string;
  action: CalibrationBridgeAction;
  payload?: unknown;
};

type CalibrationResp = {
  __ampooseCalibrationResp: true;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

function isCalibrationReq(value: unknown): value is CalibrationReq {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<CalibrationReq>;
  return data.__ampooseCalibrationReq === true && typeof data.id === "string" && typeof data.action === "string";
}

function isCalibrationResp(value: unknown): value is CalibrationResp {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<CalibrationResp>;
  return data.__ampooseCalibrationResp === true && typeof data.id === "string" && typeof data.ok === "boolean";
}

function postResponse(resp: CalibrationResp) {
  window.postMessage(resp, "*");
}

function isGraphqlFetchPayload(value: unknown): value is GraphqlFetchPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<GraphqlFetchPayload>;
  return typeof payload.endpoint === "string" && payload.endpoint.length > 0;
}

function isAllowedGraphqlEndpoint(endpoint: string): boolean {
  if (endpoint.startsWith("/")) return true;
  try {
    const parsed = new URL(endpoint, window.location.origin);
    return /(^|\.)facebook\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function normalizeHeaders(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!key || typeof value !== "string") continue;
    out[key] = value;
  }
  return out;
}

type CalibrationManager = {
  start: () => void;
  stop: () => void;
  getCaptureCount: () => number;
  getMissing: () => string[];
  getCapturedNames: () => string[];
  getUnmatchedNames: () => string[];
  buildArtifact: () => unknown;
  isActive: () => boolean;
};

export function installMainWorldCalibrationBridge(manager: CalibrationManager): () => void {
  async function handleGraphqlFetch(id: string, payload: unknown) {
    try {
      if (!isGraphqlFetchPayload(payload)) {
        throw new Error("Invalid graphqlFetch payload");
      }
      if (!isAllowedGraphqlEndpoint(payload.endpoint)) {
        throw new Error(`Disallowed graphql endpoint: ${payload.endpoint}`);
      }

      const method = (payload.method ?? "POST").toUpperCase();
      if (method !== "POST") {
        throw new Error(`Unsupported graphql fetch method: ${method}`);
      }

      const init: RequestInit = {
        method,
        credentials: "include",
        headers: normalizeHeaders(payload.headers)
      };
      if (typeof payload.body === "string") init.body = payload.body;

      const response = await fetch(payload.endpoint, init);
      const body = await response.text().catch(() => "");

      postResponse({
        __ampooseCalibrationResp: true,
        id,
        ok: true,
        result: {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          url: response.url || payload.endpoint,
          body
        }
      });
    } catch (error) {
      postResponse({
        __ampooseCalibrationResp: true,
        id,
        ok: false,
        error: String(error instanceof Error ? error.message : error)
      });
    }
  }

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    if (!isCalibrationReq(event.data)) return;

    const { id, action } = event.data;

    try {
      if (action === "start") {
        manager.start();
        postResponse({ __ampooseCalibrationResp: true, id, ok: true });
        return;
      }
      if (action === "stop") {
        manager.stop();
        postResponse({ __ampooseCalibrationResp: true, id, ok: true });
        return;
      }
      if (action === "status") {
        postResponse({
          __ampooseCalibrationResp: true,
          id,
          ok: true,
          result: {
            active: manager.isActive(),
            captureCount: manager.getCaptureCount(),
            missing: manager.getMissing(),
            capturedNames: manager.getCapturedNames(),
            unmatchedNames: manager.getUnmatchedNames()
          }
        });
        return;
      }
      if (action === "buildArtifact") {
        postResponse({
          __ampooseCalibrationResp: true,
          id,
          ok: true,
          result: manager.buildArtifact()
        });
        return;
      }
      if (action === "graphqlFetch") {
        void handleGraphqlFetch(id, event.data.payload);
        return;
      }

      postResponse({
        __ampooseCalibrationResp: true,
        id,
        ok: false,
        error: `Unknown action: ${action}`
      });
    } catch (error) {
      postResponse({
        __ampooseCalibrationResp: true,
        id,
        ok: false,
        error: String(error instanceof Error ? error.message : error)
      });
    }
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

export async function requestCalibrationAction<T = unknown>(
  action: CalibrationBridgeAction,
  timeoutMs = 4000,
  payload?: unknown
): Promise<T> {
  const id = `ampoose-calibration-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return await new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error(`Calibration bridge timeout for action ${action}`));
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (!isCalibrationResp(event.data)) return;
      if (event.data.id !== id) return;

      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);

      if (!event.data.ok) {
        reject(new Error(event.data.error ?? `Calibration action failed: ${action}`));
        return;
      }
      resolve(event.data.result as T);
    };

    window.addEventListener("message", onMessage);
    window.postMessage(
      {
        __ampooseCalibrationReq: true,
        id,
        action,
        payload
      } satisfies CalibrationReq,
      "*"
    );
  });
}
