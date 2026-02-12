import type { BridgeAction, BridgeRequestPayloadMap } from '@/runtime/bridge/actions';

export function sendRuntimeMessage<A extends BridgeAction>(
    action: A,
    payload: BridgeRequestPayloadMap[A],
): Promise<unknown> {
    return chrome.runtime.sendMessage({ action, payload });
}
