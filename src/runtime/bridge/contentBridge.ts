import type { BridgeAction, BridgeRequestPayloadMap } from "@/runtime/bridge/actions";

type BridgeEnvelope = {
  __ampooseBridgeReq?: true;
  __ampooseBridgeResp?: true;
  id?: string;
  action?: BridgeAction;
  payload?: unknown[];
  response?: unknown;
  error?: string | null;
};

export function installContentBridge() {
  const onMessage = (event: MessageEvent<BridgeEnvelope>) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__ampooseBridgeReq !== true) return;
    if (!data.id || !data.action) return;

    const reqId = data.id;
    const payload = Array.isArray(data.payload) ? data.payload : [];
    try {
      chrome.runtime.sendMessage(
        {
          action: data.action,
          payload
        },
        (response) => {
          const envelope: BridgeEnvelope = {
            __ampooseBridgeResp: true,
            id: reqId,
            response,
            error: chrome.runtime.lastError
              ? String(chrome.runtime.lastError.message ?? chrome.runtime.lastError)
              : null
          };
          window.postMessage(envelope, "*");
        }
      );
    } catch (error) {
      const envelope: BridgeEnvelope = {
        __ampooseBridgeResp: true,
        id: reqId,
        response: null,
        error: String(error instanceof Error ? error.message : error)
      };
      window.postMessage(envelope, "*");
    }
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

export function sendRuntimeMessage<A extends BridgeAction>(
  action: A,
  payload: BridgeRequestPayloadMap[A]
): Promise<unknown> {
  return chrome.runtime.sendMessage({ action, payload });
}
