import { describe, expect, it, mock } from 'bun:test';
import { createMountApp } from '@/ui/mount';

describe('mountApp', () => {
    it('should wire controller actions and bridge calls', async () => {
        const sendRuntimeMessage = mock(async () => ({ ok: true }));
        const requestCalibrationAction = mock(
            async (_action: string, _timeoutMs?: number, _payload?: unknown, _signal?: AbortSignal) => ({
                body: '{}',
                ok: true,
                status: 200,
                statusText: 'OK',
                url: '',
            }),
        );

        const loadCalibrationArtifact = mock(async () => null);
        const saveCalibrationArtifact = mock(async () => {});

        const createRoot = mock((_container: HTMLElement) => {
            return {
                render: mock((node: any) => {
                    if (node?.type && node?.props) {
                        node.type(node.props);
                    }
                }),
                unmount: mock(() => {}),
            };
        });

        const createGraphqlClient = mock((deps: any) => {
            return {
                request: async () => {
                await deps.fetchImpl('/api/graphql/', {
                    body: 'a=1&b=2',
                    headers: { z: '1' },
                    method: 'POST',
                });

                await deps.fetchImpl('/api/graphql/', {
                    body: new URLSearchParams({ a: '1' }),
                    headers: new Headers({ a: 'b' }),
                    method: 'POST',
                    });

                    const form = new FormData();
                    form.set('x', '1');
                    await deps.fetchImpl(new URL('https://www.facebook.com/graphql/query/'), {
                        body: form,
                        headers: [['x', '1']],
                        method: 'post',
                    });

                await deps.fetchImpl('/api/graphql/', {
                    body: new Blob(['hi'], { type: 'text/plain' }),
                    headers: { y: 2 },
                    method: 'POST',
                });

                await deps.fetchImpl('/api/graphql/', {
                    body: { k: 1 } as any,
                    headers: { y: 2 },
                    method: 'POST',
                });

                    const fetchAbort = new AbortController();
                    await deps.fetchImpl('/api/graphql/', {
                        method: 'POST',
                        signal: fetchAbort.signal,
                    });

                    await deps.fetchImpl('/api/graphql/', { method: 'POST' });
                    return { ok: true };
                },
            };
        });

        let lastQueryInput: any;
        const queryProfileTimelinePage = mock(async (client: any, input: any) => {
            lastQueryInput = input;
            await client.request({ queryName: 'ProfileCometTimelineFeedRefetchQuery' });
            return { nextCursor: null, posts: [] };
        });

        const controllerCalls: string[] = [];
        const state = {
            calibrationStatus: 'missing',
            chunkState: { partFiles: [] },
            collectionId: '',
            error: null,
            folderNames: [],
            isOnLimit: false,
            isStopManually: true,
            logs: [],
            open: false,
            posts: [],
            progress: {
                cursor: null,
                duplicateStreak: 0,
                lastBatchCount: 0,
                nextCursor: null,
                pagesFetched: 0,
                totalPosts: 0,
            },
            runId: 1,
            settings: {
                fetchingCountByPostCountValue: 25,
                fetchingCountByPostDaysValue: 7,
                fetchingCountType: 0,
                isUsePostsFilter: false,
            },
            step: 'START',
        };

        class FakeRunController {
            private deps: any;

            constructor(deps: any) {
                this.deps = deps;
            }

            subscribe(cb: () => void) {
                cb();
                return () => {
                };
            }

            getState() {
                return state as any;
            }

            setOpen(open: boolean) {
                controllerCalls.push(`setOpen:${open}`);
            }

            updateSettings(_patch: any) {
                controllerCalls.push('updateSettings');
            }

            addLog(_type: any, _msg: string) {
                controllerCalls.push('addLog');
            }

            async loadCalibrationStatus() {
                controllerCalls.push('loadCalibrationStatus');
                return null;
            }

            async start() {
                controllerCalls.push('start');
                await this.deps.queryPage({ cursor: null, settings: {}, signal: new AbortController().signal });
            }

            stop() {
                controllerCalls.push('stop');
            }

            async continue() {
                controllerCalls.push('continue');
            }

            async downloadJson() {
                controllerCalls.push('downloadJson');
                await this.deps.downloadClient.downloadTextAsFile('x', 'posts.json', 'application/json', false);
            }

            async downloadJsonRedacted() {
                controllerCalls.push('downloadJsonRedacted');
                await this.deps.downloadClient.downloadTextAsFile(
                    'x',
                    'posts-redacted.json',
                    'application/json',
                    false,
                );
            }

            async downloadLogsJson() {
                controllerCalls.push('downloadLogsJson');
                await this.deps.downloadClient.downloadTextAsFile('x', 'logs.json', 'application/json', false);
            }

            async probeEarliestAccessiblePost() {
                controllerCalls.push('probeEarliestAccessiblePost');
            }

            stopProbe() {
                controllerCalls.push('stopProbe');
            }

            async startCalibrationCapture() {
                controllerCalls.push('startCalibrationCapture');
                await this.deps.calibrationClient.startCapture();
            }

            async stopCalibrationCapture() {
                controllerCalls.push('stopCalibrationCapture');
                await this.deps.calibrationClient.stopCapture();
            }

            async saveCalibrationFromCapture() {
                controllerCalls.push('saveCalibrationFromCapture');
                await this.deps.calibrationClient.getStatus();
                await this.deps.calibrationClient.buildArtifact();
                await this.deps.calibrationClient.stopCapture();
            }
        }

        let captured: any;
        const App = (props: any) => {
            captured = props;
            return null;
        };

        const mountApp = createMountApp({
            App,
            RunController: FakeRunController as any,
            createGraphqlClient: createGraphqlClient as any,
            createRoot: createRoot as any,
            loadCalibrationArtifact: loadCalibrationArtifact as any,
            queryProfileTimelinePage: queryProfileTimelinePage as any,
            requestCalibrationAction: requestCalibrationAction as any,
            saveCalibrationArtifact: saveCalibrationArtifact as any,
            sendRuntimeMessage: sendRuntimeMessage as any,
        });

        const container = document.createElement('div');
        const unmount = mountApp(container);

        expect(captured).toBeTruthy();

        await captured.onStart();
        await captured.onDownload();
        await captured.onDownloadRedacted();
        await captured.onDownloadLogs();
        await captured.onProbeEarliestPost();
        captured.onStopProbe();
        captured.onOpen(true);
        captured.onSetMode(1);
        captured.onSetCount(10);
        captured.onSetDays(3);
        captured.onSetUseDateFilter(true);
        await captured.onStop();
        await captured.onContinue();
        await captured.onCalibrationStart();
        await captured.onCalibrationStop();
        await captured.onCalibrationSave();

        expect(createGraphqlClient).toHaveBeenCalledTimes(1);
        expect(queryProfileTimelinePage).toHaveBeenCalledTimes(1);
        expect(requestCalibrationAction).toHaveBeenCalled();
        expect(sendRuntimeMessage).toHaveBeenCalledWith('downloadTextAsFile', ['x', 'posts.json', 'application/json', false]);
        expect(sendRuntimeMessage).toHaveBeenCalledWith(
            'downloadTextAsFile',
            ['x', 'posts-redacted.json', 'application/json', false],
        );
        expect(sendRuntimeMessage).toHaveBeenCalledWith('downloadTextAsFile', ['x', 'logs.json', 'application/json', false]);
        expect(controllerCalls).toContain('probeEarliestAccessiblePost');
        expect(controllerCalls).toContain('stopProbe');
        expect(lastQueryInput?.signal).toBeInstanceOf(AbortSignal);
        expect(
            requestCalibrationAction.mock.calls.some((call) => call[3] instanceof AbortSignal),
        ).toBe(true);

        unmount();
        expect(controllerCalls).toContain('stopCalibrationCapture');
    });
});
