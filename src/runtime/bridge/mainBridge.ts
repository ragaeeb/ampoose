import type {
  BridgeAction,
  BridgeRequestPayloadMap,
  BridgeResponsePayloadMap
} from "@/runtime/bridge/actions";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeoutId: number;
};

type MainBridge = {
  send<A extends BridgeAction>(
    action: A,
    ...payload: BridgeRequestPayloadMap[A]
  ): Promise<BridgeResponsePayloadMap[A]>;
};

declare global {
  interface Window {
    __ampooseBridge?: MainBridge;
  }
}

export function installMainWorldBridge(timeoutMs = 10_000): MainBridge {
  const pending = new Map<string, PendingRequest>();
  let seq = 0;

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as
      | {
          __ampooseBridgeResp?: true;
          id?: string;
          response?: unknown;
          error?: string | null;
        }
      | undefined;
    if (!data || data.__ampooseBridgeResp !== true || !data.id) return;

    const next = pending.get(data.id);
    if (!next) return;

    pending.delete(data.id);
    clearTimeout(next.timeoutId);
    if (data.error) {
      next.reject(new Error(data.error));
      return;
    }
    next.resolve(data.response);
  };

  window.addEventListener("message", onMessage);

  const bridge: MainBridge = {
    send(action, ...payload) {
      return new Promise<BridgeResponsePayloadMap[typeof action]>((resolve, reject) => {
        const id = `ampoose-${Date.now()}-${++seq}`;
        const timeoutId = window.setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Bridge timeout for action ${action}`));
        }, timeoutMs);

        pending.set(id, {
          resolve: (value) => resolve(value as BridgeResponsePayloadMap[typeof action]),
          reject,
          timeoutId
        });

        window.postMessage(
          {
            __ampooseBridgeReq: true,
            id,
            action,
            payload
          },
          "*"
        );
      });
    }
  };

  window.__ampooseBridge = bridge;
  return bridge;
}
