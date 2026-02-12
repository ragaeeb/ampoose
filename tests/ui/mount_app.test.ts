import { describe, expect, it, mock } from 'bun:test';
import { createMountApp } from '@/ui/mount';

describe('mountApp', () => {
    it('should wire controller actions and bridge calls', async () => {
        const sendRuntimeMessage = mock(async () => ({ ok: true }));
        const requestCalibrationAction = mock(async (_action: string, _timeoutMs?: number, _payload?: unknown) => ({
            body: '{}',
            ok: true,
            status: 200,
            statusText: 'OK',
            url: '',
        }));

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

                    await deps.fetchImpl('/api/graphql/', { method: 'POST' });
                    return { ok: true };
                },
            };
        });

        const queryProfileTimelinePage = mock(async (client: any) => {
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

            async downloadLogsJson() {
                controllerCalls.push('downloadLogsJson');
                await this.deps.downloadClient.downloadTextAsFile('x', 'logs.json', 'application/json', false);
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
            }
        }

        const App = (props: any) => {
            (globalThis as any).__capturedMountProps = props;
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

        const captured = (globalThis as any).__capturedMountProps as any;
        expect(captured).toBeTruthy();

        await captured.onStart();
        await captured.onDownload();
        await captured.onDownloadLogs();
        captured.onOpen(true);
        captured.onSetMode(1);
        captured.onSetCount(10);
        captured.onSetDays(3);
        captured.onSetUseDateFilter(true);
        captured.onStop();
        await captured.onContinue();
        captured.onCalibrationStart();
        captured.onCalibrationStop();
        await captured.onCalibrationSave();

        expect(createGraphqlClient).toHaveBeenCalledTimes(1);
        expect(queryProfileTimelinePage).toHaveBeenCalledTimes(1);
        expect(requestCalibrationAction).toHaveBeenCalled();
        expect(sendRuntimeMessage).toHaveBeenCalledWith('downloadTextAsFile', ['x', 'posts.json', 'application/json', false]);
        expect(sendRuntimeMessage).toHaveBeenCalledWith('downloadTextAsFile', ['x', 'logs.json', 'application/json', false]);

        unmount();
        expect(controllerCalls).toContain('stopCalibrationCapture');
    });
});
