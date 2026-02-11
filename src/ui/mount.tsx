import ReactDOM from "react-dom/client";
import { App } from "@/ui/App";
import { RunController } from "@/runtime/controller/runController";
import { sendRuntimeMessage } from "@/runtime/bridge/contentBridge";
import { requestCalibrationAction } from "@/runtime/calibration/mainWorldBridge";
import {
  loadCalibrationArtifact,
  saveCalibrationArtifact
} from "@/runtime/calibration/storage";
import { createGraphqlClient } from "@/domain/graphql/client";
import { queryProfileTimelinePage } from "@/runtime/query/profileTimeline";

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    const out: Record<string, string> = {};
    for (const [key, value] of headers) out[key] = value;
    return out;
  }
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, String(value)])
  );
}

async function bodyToString(body: unknown): Promise<string> {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const params = new URLSearchParams();
    for (const [key, value] of body.entries()) params.set(key, String(value));
    return params.toString();
  }
  if (body instanceof Blob) return await body.text();
  return String(body);
}

export function mountApp(container: HTMLElement) {
  const root = ReactDOM.createRoot(container);
  const mainWorldFetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = await bodyToString(init?.body);
    const headers = headersToRecord(init?.headers);
    const result = await requestCalibrationAction<{
      ok: boolean;
      status: number;
      statusText?: string;
      url: string;
      body: string;
    }>("graphqlFetch", 15_000, {
      endpoint: url,
      method: (init?.method ?? "POST").toUpperCase(),
      headers,
      body
    });

    const responseInit: ResponseInit = {
      status: result.status,
      headers: {
        "content-type": "application/json"
      }
    };
    if (typeof result.statusText === "string") responseInit.statusText = result.statusText;
    return new Response(result.body, responseInit);
  };
  const graphqlClient = createGraphqlClient({
    loadArtifact: loadCalibrationArtifact,
    fetchImpl: mainWorldFetchImpl as unknown as typeof fetch
  });

  const controller = new RunController({
    queryPage: async ({ cursor }) => {
      const page = await queryProfileTimelinePage(graphqlClient, { cursor });
      return {
        posts: page.posts,
        nextCursor: page.nextCursor
      };
    },
    downloadClient: {
      downloadTextAsFile: (text, filename, mimeType, useDataUrl) =>
        sendRuntimeMessage("downloadTextAsFile", [
          text,
          filename,
          mimeType ?? "application/json",
          Boolean(useDataUrl)
        ]) as Promise<{ ok: boolean; method?: "blob" | "data"; id?: number; error?: string }>
    },
    loadCalibration: loadCalibrationArtifact,
    saveCalibration: saveCalibrationArtifact,
    getCurrentUrl: () => window.location.href,
    calibrationClient: {
      startCapture: async () => {
        await requestCalibrationAction("start");
      },
      stopCapture: async () => {
        await requestCalibrationAction("stop");
      },
      getStatus: async () => {
        return await requestCalibrationAction<{
          active: boolean;
          captureCount: number;
          missing: string[];
          capturedNames?: string[];
          unmatchedNames?: string[];
        }>("status");
      },
      buildArtifact: async () => {
        return await requestCalibrationAction("buildArtifact");
      }
    }
  });

  const render = () => {
    const state = controller.getState();

    root.render(
      <App
        state={state}
        onOpen={(open) => controller.setOpen(open)}
        onStart={() => controller.start()}
        onStop={() => controller.stop()}
        onContinue={() => controller.continue()}
        onDownload={() => controller.downloadJson()}
        onDownloadLogs={() => controller.downloadLogsJson()}
        onSetMode={(mode) => controller.updateSettings({ fetchingCountType: mode })}
        onSetCount={(count) => controller.updateSettings({ fetchingCountByPostCountValue: count })}
        onSetDays={(days) => controller.updateSettings({ fetchingCountByPostDaysValue: days })}
        onSetUseDateFilter={(value) => controller.updateSettings({ isUsePostsFilter: value })}
        onCalibrationStart={() => controller.startCalibrationCapture()}
        onCalibrationStop={() => controller.stopCalibrationCapture()}
        onCalibrationSave={() => controller.saveCalibrationFromCapture()}
      />
    );
  };

  const unsubscribe = controller.subscribe(() => {
    render();
  });

  controller
    .loadCalibrationStatus()
    .catch((error) => controller.addLog("error", `calibration: status load failed ${String(error)}`));

  render();

  return () => {
    unsubscribe();
    void controller.stopCalibrationCapture().catch(() => {});
    root.unmount();
  };
}
