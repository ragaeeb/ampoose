import type { BridgeAction, BridgeRequestPayloadMap, BridgeResponsePayloadMap } from '@/runtime/bridge/actions';

export function sendRuntimeMessage<A extends BridgeAction>(
    action: A,
    payload: BridgeRequestPayloadMap[A],
): Promise<BridgeResponsePayloadMap[A]> {
    return chrome.runtime.sendMessage({ action, payload });
}
