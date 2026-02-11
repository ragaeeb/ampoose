import type { ChunkState } from "@/domain/chunk/chunking";
import type { GraphqlArtifactV1, RunProgress, RunStep } from "@/domain/types";
import type { RuntimeSettings } from "@/runtime/settings/types";
import type { LogEntry } from "@/runtime/logs/logStore";

export type RuntimePost = Record<string, unknown>;

export type QueryPageResult = {
  nextCursor: string | null;
  posts: RuntimePost[];
};

export type QueryPageInput = {
  cursor: string | null;
  settings: RuntimeSettings;
  signal: AbortSignal;
};

export type DownloadClient = {
  downloadTextAsFile: (
    text: string,
    filename: string,
    mimeType?: string,
    useDataUrl?: boolean
  ) => Promise<{ ok: boolean; method?: "blob" | "data"; id?: number; error?: string }>;
};

export type CalibrationClient = {
  startCapture: () => Promise<void>;
  stopCapture: () => Promise<void>;
  getStatus: () => Promise<{
    active: boolean;
    captureCount: number;
    missing: string[];
    capturedNames?: string[];
    unmatchedNames?: string[];
  }>;
  buildArtifact: () => Promise<unknown>;
};

export type ControllerDeps = {
  queryPage: (input: QueryPageInput) => Promise<QueryPageResult>;
  downloadClient: DownloadClient;
  loadCalibration: () => Promise<GraphqlArtifactV1 | null>;
  saveCalibration: (artifact: GraphqlArtifactV1) => Promise<void>;
  calibrationClient: CalibrationClient;
  getCurrentUrl?: () => string;
};

export type ControllerState = {
  step: RunStep;
  open: boolean;
  error: string | null;
  settings: RuntimeSettings;
  progress: RunProgress;
  isOnLimit: boolean;
  isStopManually: boolean;
  posts: RuntimePost[];
  chunkState: ChunkState;
  logs: LogEntry[];
  runId: number;
  calibrationStatus: "missing" | "ready" | "capturing";
  collectionId: string;
  folderNames: string[];
};
