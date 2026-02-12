import ReactDOM from 'react-dom/client';
import type { ComponentType } from 'react';
import { createGraphqlClient } from '@/domain/graphql/client';
import { sendRuntimeMessage } from '@/runtime/bridge/contentBridge';
import { requestCalibrationAction } from '@/runtime/calibration/mainWorldBridge';
import { loadCalibrationArtifact, saveCalibrationArtifact } from '@/runtime/calibration/storage';
import { RunController } from '@/runtime/controller/runController';
import { queryProfileTimelinePage } from '@/runtime/query/profileTimeline';
import { App } from '@/ui/App';
import type { AppProps } from '@/ui/App';

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
    if (!headers) {
        return {};
    }
    if (headers instanceof Headers) {
        const out: Record<string, string> = {};
        headers.forEach((value, key) => {
            out[key] = value;
        });
        return out;
    }
    if (Array.isArray(headers)) {
        const out: Record<string, string> = {};
        for (const [key, value] of headers) {
            out[key] = value;
        }
        return out;
    }
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

async function bodyToString(body: unknown): Promise<string> {
    if (!body) {
        return '';
    }
    if (typeof body === 'string') {
        return body;
    }
    if (body instanceof URLSearchParams) {
        return body.toString();
    }
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
        const params = new URLSearchParams();
        for (const [key, value] of body.entries()) {
            params.set(key, String(value));
        }
        return params.toString();
    }
    if (body instanceof Blob) {
        return await body.text();
    }
    return String(body);
}

export type MountAppDeps = {
    createRoot: typeof ReactDOM.createRoot;
    createGraphqlClient: typeof createGraphqlClient;
    sendRuntimeMessage: typeof sendRuntimeMessage;
    requestCalibrationAction: typeof requestCalibrationAction;
    loadCalibrationArtifact: typeof loadCalibrationArtifact;
    saveCalibrationArtifact: typeof saveCalibrationArtifact;
    RunController: typeof RunController;
    queryProfileTimelinePage: typeof queryProfileTimelinePage;
    App: ComponentType<AppProps>;
};

export function createMountApp(deps: MountAppDeps) {
    return function mountApp(container: HTMLElement) {
        const root = deps.createRoot(container);
        const mainWorldFetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            const body = await bodyToString(init?.body);
            const headers = headersToRecord(init?.headers);
            const result = await deps.requestCalibrationAction<{
                ok: boolean;
                status: number;
                statusText?: string;
                url: string;
                body: string;
            }>('graphqlFetch', 15_000, {
                body,
                endpoint: url,
                headers,
                method: (init?.method ?? 'POST').toUpperCase(),
            });

            const responseInit: ResponseInit = {
                headers: {
                    'content-type': 'application/json',
                },
                status: result.status,
            };
            if (typeof result.statusText === 'string') {
                responseInit.statusText = result.statusText;
            }
            return new Response(result.body, responseInit);
        };
        const graphqlClient = deps.createGraphqlClient({
            fetchImpl: mainWorldFetchImpl,
            loadArtifact: deps.loadCalibrationArtifact,
        });

        const controller = new deps.RunController({
            calibrationClient: {
                buildArtifact: async () => {
                    return await deps.requestCalibrationAction('buildArtifact');
                },
                getStatus: async () => {
                    return await deps.requestCalibrationAction<{
                        active: boolean;
                        captureCount: number;
                        missing: string[];
                        capturedNames?: string[];
                        unmatchedNames?: string[];
                    }>('status');
                },
                startCapture: async () => {
                    await deps.requestCalibrationAction('start');
                },
                stopCapture: async () => {
                    await deps.requestCalibrationAction('stop');
                },
            },
            downloadClient: {
                downloadTextAsFile: (text, filename, mimeType, useDataUrl) =>
                    deps.sendRuntimeMessage('downloadTextAsFile', [
                        text,
                        filename,
                        mimeType ?? 'application/json',
                        Boolean(useDataUrl),
                    ]) as Promise<{ ok: boolean; method?: 'blob' | 'data'; id?: number; error?: string }>,
            },
            getCurrentUrl: () => window.location.href,
            loadCalibration: deps.loadCalibrationArtifact,
            queryPage: async ({ cursor }) => {
                const page = await deps.queryProfileTimelinePage(graphqlClient, { cursor });
                return {
                    nextCursor: page.nextCursor,
                    posts: page.posts,
                };
            },
            saveCalibration: deps.saveCalibrationArtifact,
        });

        const render = () => {
            const state = controller.getState();

            root.render(
                <deps.App
                    state={state}
                    onOpen={(open: boolean) => controller.setOpen(open)}
                    onStart={() => controller.start()}
                    onStop={() => controller.stop()}
                    onContinue={() => controller.continue()}
                    onDownload={() => controller.downloadJson()}
                    onDownloadLogs={() => controller.downloadLogsJson()}
                    onSetMode={(mode) => controller.updateSettings({ fetchingCountType: mode })}
                    onSetCount={(count: number) => controller.updateSettings({ fetchingCountByPostCountValue: count })}
                    onSetDays={(days: number) => controller.updateSettings({ fetchingCountByPostDaysValue: days })}
                    onSetUseDateFilter={(value: boolean) => controller.updateSettings({ isUsePostsFilter: value })}
                    onCalibrationStart={() => controller.startCalibrationCapture()}
                    onCalibrationStop={() => controller.stopCalibrationCapture()}
                    onCalibrationSave={() => controller.saveCalibrationFromCapture()}
                />,
            );
        };

        const unsubscribe = controller.subscribe(() => {
            render();
        });

        controller
            .loadCalibrationStatus()
            .catch((error) => controller.addLog('error', `calibration: status load failed ${String(error)}`));

        render();

        return () => {
            unsubscribe();
            void controller.stopCalibrationCapture().catch(() => {});
            root.unmount();
        };
    };
}

export const mountApp = createMountApp({
    App,
    RunController,
    createGraphqlClient,
    createRoot: ReactDOM.createRoot,
    loadCalibrationArtifact,
    queryProfileTimelinePage,
    requestCalibrationAction,
    saveCalibrationArtifact,
    sendRuntimeMessage,
});
