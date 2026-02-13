import { describe, expect, it, mock } from 'bun:test';
import { sendRuntimeMessage } from '@/runtime/bridge/contentBridge';

describe('contentBridge', () => {
    it('should send a chrome.runtime message with action + payload', async () => {
        const originalChrome = (globalThis as any).chrome;
        try {
            const sendMessage = mock(async () => ({ ok: true }));
            (globalThis as any).chrome = {
                ...(originalChrome ?? {}),
                runtime: {
                    ...(originalChrome?.runtime ?? {}),
                    sendMessage,
                },
            };

            const payload = ['k', 'v'] as any;
            const result = await sendRuntimeMessage('setPersistLocalStorage' as any, payload);

            expect(sendMessage).toHaveBeenCalledWith({ action: 'setPersistLocalStorage', payload });
            expect(result).toEqual({ ok: true });
        } finally {
            (globalThis as any).chrome = originalChrome;
        }
    });
});
