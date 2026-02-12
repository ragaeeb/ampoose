import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { installMainWorldCalibrationBridge, requestCalibrationAction } from '@/runtime/calibration/mainWorldBridge';

describe('mainWorldBridge', () => {
    let originalFetch: typeof fetch | undefined;
    let originalPostMessage: typeof window.postMessage | undefined;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        originalPostMessage = window.postMessage;

        // happy-dom doesn't always populate MessageEvent.source for postMessage.
        // Shim to dispatch MessageEvent with source=window so bridge logic runs in tests.
        window.postMessage = ((data: unknown) => {
            window.dispatchEvent(new MessageEvent('message', { data, source: window as any } as any));
        }) as any;
    });

    afterEach(() => {
        (globalThis as any).fetch = originalFetch;
        (window as any).postMessage = originalPostMessage;
    });

    it('should respond to status/start/stop/buildArtifact actions', async () => {
        const manager = {
            buildArtifact: mock(() => ({ ok: true })),
            getCaptureCount: mock(() => 3),
            getCapturedNames: mock(() => ['A']),
            getMissing: mock(() => []),
            getUnmatchedNames: mock(() => ['B']),
            isActive: mock(() => true),
            start: mock(() => {}),
            stop: mock(() => {}),
        };

        const uninstall = installMainWorldCalibrationBridge(manager);

        const responses: any[] = [];
        const onMessage = (event: MessageEvent) => {
            if (event.source !== window) {
                return;
            }
            if (event.data?.__ampooseCalibrationResp) {
                responses.push(event.data);
            }
        };
        window.addEventListener('message', onMessage);

        window.postMessage({ __ampooseCalibrationReq: true, id: '1', action: 'status' }, '*');
        window.postMessage({ __ampooseCalibrationReq: true, id: '2', action: 'start' }, '*');
        window.postMessage({ __ampooseCalibrationReq: true, id: '3', action: 'stop' }, '*');
        window.postMessage({ __ampooseCalibrationReq: true, id: '4', action: 'buildArtifact' }, '*');

        expect(responses.find((r) => r.id === '1')?.result?.captureCount).toBe(3);
        expect(manager.start).toHaveBeenCalledTimes(1);
        expect(manager.stop).toHaveBeenCalledTimes(1);
        expect(responses.find((r) => r.id === '4')?.result).toEqual({ ok: true });

        window.removeEventListener('message', onMessage);
        uninstall();
    });

    it('should reject unknown actions', async () => {
        const manager = {
            buildArtifact: () => ({}),
            getCaptureCount: () => 0,
            getCapturedNames: () => [],
            getMissing: () => [],
            getUnmatchedNames: () => [],
            isActive: () => false,
            start: () => {},
            stop: () => {},
        };

        const uninstall = installMainWorldCalibrationBridge(manager);

        const resp = await new Promise<any>((resolve) => {
            const onMessage = (event: MessageEvent) => {
                if (event.source !== window) {
                    return;
                }
                if (event.data?.__ampooseCalibrationResp && event.data.id === 'x') {
                    window.removeEventListener('message', onMessage);
                    resolve(event.data);
                }
            };
            window.addEventListener('message', onMessage);
            window.postMessage({ __ampooseCalibrationReq: true, id: 'x', action: 'nope' }, '*');
        });

        expect(resp.ok).toBe(false);
        expect(resp.error).toMatch(/unknown action/i);
        uninstall();
    });

    it('should perform graphqlFetch for allowed endpoints', async () => {
        const manager = {
            buildArtifact: () => ({}),
            getCaptureCount: () => 0,
            getCapturedNames: () => [],
            getMissing: () => [],
            getUnmatchedNames: () => [],
            isActive: () => false,
            start: () => {},
            stop: () => {},
        };

        const fetchMock = mock(async () => new Response('{"ok":true}', { status: 200, statusText: 'OK' }));
        (globalThis as any).fetch = fetchMock;

        const uninstall = installMainWorldCalibrationBridge(manager);

        const resp = await new Promise<any>((resolve) => {
            const onMessage = (event: MessageEvent) => {
                if (event.source !== window) {
                    return;
                }
                if (event.data?.__ampooseCalibrationResp && event.data.id === 'g') {
                    window.removeEventListener('message', onMessage);
                    resolve(event.data);
                }
            };
            window.addEventListener('message', onMessage);
            window.postMessage(
                {
                    __ampooseCalibrationReq: true,
                    id: 'g',
                    action: 'graphqlFetch',
                    payload: { endpoint: '/api/graphql/', method: 'POST', body: 'a=1', headers: { a: 'b' } },
                },
                '*',
            );
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(resp.ok).toBe(true);
        expect(resp.result.status).toBe(200);
        expect(resp.result.body).toContain('ok');

        uninstall();
    });

    it('should reject graphqlFetch for disallowed endpoints', async () => {
        const manager = {
            buildArtifact: () => ({}),
            getCaptureCount: () => 0,
            getCapturedNames: () => [],
            getMissing: () => [],
            getUnmatchedNames: () => [],
            isActive: () => false,
            start: () => {},
            stop: () => {},
        };

        const uninstall = installMainWorldCalibrationBridge(manager);

        const resp = await new Promise<any>((resolve) => {
            const onMessage = (event: MessageEvent) => {
                if (event.source !== window) {
                    return;
                }
                if (event.data?.__ampooseCalibrationResp && event.data.id === 'bad') {
                    window.removeEventListener('message', onMessage);
                    resolve(event.data);
                }
            };
            window.addEventListener('message', onMessage);
            window.postMessage(
                {
                    __ampooseCalibrationReq: true,
                    id: 'bad',
                    action: 'graphqlFetch',
                    payload: { endpoint: 'https://evil.example/graphql', method: 'POST' },
                },
                '*',
            );
        });

        expect(resp.ok).toBe(false);
        expect(resp.error).toMatch(/disallowed/i);
        uninstall();
    });

    it('should reject graphqlFetch with invalid payload and unsupported method', async () => {
        const manager = {
            buildArtifact: () => ({}),
            getCaptureCount: () => 0,
            getCapturedNames: () => [],
            getMissing: () => [],
            getUnmatchedNames: () => [],
            isActive: () => false,
            start: () => {},
            stop: () => {},
        };
        const uninstall = installMainWorldCalibrationBridge(manager);

        const invalidPayloadResp = await new Promise<any>((resolve) => {
            const onMessage = (event: MessageEvent) => {
                if (event.source !== window) {
                    return;
                }
                if (event.data?.__ampooseCalibrationResp && event.data.id === 'inv') {
                    window.removeEventListener('message', onMessage);
                    resolve(event.data);
                }
            };
            window.addEventListener('message', onMessage);
            window.postMessage({ __ampooseCalibrationReq: true, id: 'inv', action: 'graphqlFetch', payload: null }, '*');
        });
        expect(invalidPayloadResp.ok).toBe(false);
        expect(invalidPayloadResp.error).toMatch(/invalid graphqlfetch payload/i);

        const methodResp = await new Promise<any>((resolve) => {
            const onMessage = (event: MessageEvent) => {
                if (event.source !== window) {
                    return;
                }
                if (event.data?.__ampooseCalibrationResp && event.data.id === 'method') {
                    window.removeEventListener('message', onMessage);
                    resolve(event.data);
                }
            };
            window.addEventListener('message', onMessage);
            window.postMessage(
                {
                    __ampooseCalibrationReq: true,
                    id: 'method',
                    action: 'graphqlFetch',
                    payload: { endpoint: '/api/graphql/', method: 'GET' },
                },
                '*',
            );
        });
        expect(methodResp.ok).toBe(false);
        expect(methodResp.error).toMatch(/unsupported graphql fetch method/i);
        uninstall();
    });

    it('should normalize headers and ignore malformed message events', async () => {
        const manager = {
            buildArtifact: () => ({}),
            getCaptureCount: () => 0,
            getCapturedNames: () => [],
            getMissing: () => [],
            getUnmatchedNames: () => [],
            isActive: () => false,
            start: mock(() => {}),
            stop: () => {},
        };
        const fetchMock = mock(async () => new Response('{"ok":true}', { status: 200, statusText: 'OK' }));
        (globalThis as any).fetch = fetchMock;

        const uninstall = installMainWorldCalibrationBridge(manager);

        window.dispatchEvent(new MessageEvent('message', { data: { __ampooseCalibrationReq: true, id: 'x', action: 'start' } }));
        expect(manager.start).toHaveBeenCalledTimes(0);

        await new Promise<void>((resolve) => {
            const onMessage = (event: MessageEvent) => {
                if (event.source !== window) {
                    return;
                }
                if (event.data?.__ampooseCalibrationResp && event.data.id === 'hdr') {
                    window.removeEventListener('message', onMessage);
                    resolve();
                }
            };
            window.addEventListener('message', onMessage);
            window.postMessage(
                {
                    __ampooseCalibrationReq: true,
                    id: 'hdr',
                    action: 'graphqlFetch',
                    payload: {
                        endpoint: '/api/graphql/',
                        method: 'POST',
                        headers: { '': 'bad', a: 'ok', b: 2 } as any,
                    },
                },
                '*',
            );
        });

        expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ a: 'ok' });
        uninstall();
    });

    it('should ignore non-object message payloads and allow missing headers', async () => {
        const manager = {
            buildArtifact: () => ({}),
            getCaptureCount: () => 0,
            getCapturedNames: () => [],
            getMissing: () => [],
            getUnmatchedNames: () => [],
            isActive: () => false,
            start: mock(() => {}),
            stop: () => {},
        };
        const fetchMock = mock(async () => new Response('{"ok":true}', { status: 200, statusText: 'OK' }));
        (globalThis as any).fetch = fetchMock;
        const uninstall = installMainWorldCalibrationBridge(manager);

        window.postMessage('bad-payload', '*');
        expect(manager.start).toHaveBeenCalledTimes(0);

        await new Promise<void>((resolve) => {
            const onMessage = (event: MessageEvent) => {
                if (event.source !== window) {
                    return;
                }
                if (event.data?.__ampooseCalibrationResp && event.data.id === 'no-headers') {
                    window.removeEventListener('message', onMessage);
                    resolve();
                }
            };
            window.addEventListener('message', onMessage);
            window.postMessage(
                {
                    __ampooseCalibrationReq: true,
                    id: 'no-headers',
                    action: 'graphqlFetch',
                    payload: { endpoint: '/api/graphql/', method: 'POST' },
                },
                '*',
            );
        });

        expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({});
        uninstall();
    });

    it('should resolve requestCalibrationAction when the response arrives', async () => {
        const onReq = (event: MessageEvent) => {
            if (event.source !== window) {
                return;
            }
            const data = event.data as any;
            if (!data?.__ampooseCalibrationReq) {
                return;
            }
            window.postMessage({ __ampooseCalibrationResp: true, id: data.id, ok: true, result: { ok: 1 } }, '*');
        };
        window.addEventListener('message', onReq);
        const result = await requestCalibrationAction('status', 200);
        expect(result).toEqual({ ok: 1 });

        window.removeEventListener('message', onReq);
    });

    it('should reject requestCalibrationAction on timeout', async () => {
        let error: Error | null = null;
        try {
            await requestCalibrationAction('status', 20);
        } catch (err) {
            error = err as Error;
        }
        expect(error?.message).toMatch(/timeout/i);
    });

    it('should ignore mismatched responses and reject on explicit bridge failure', async () => {
        const onReq = (event: MessageEvent) => {
            if (event.source !== window) {
                return;
            }
            const data = event.data as any;
            if (!data?.__ampooseCalibrationReq) {
                return;
            }
            window.postMessage('bad-response', '*');
            window.postMessage({ __ampooseCalibrationResp: true, id: `${data.id}-other`, ok: true, result: { ok: 2 } }, '*');
            window.postMessage({ __ampooseCalibrationResp: true, id: data.id, ok: false }, '*');
        };
        window.addEventListener('message', onReq);

        await expect(requestCalibrationAction('status', 200)).rejects.toThrow('Calibration action failed: status');

        window.removeEventListener('message', onReq);
    });
});
