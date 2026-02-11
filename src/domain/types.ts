export type ExportPost = {
  id: string;
  content: string;
  createdAt?: number;
};

export type ExportEnvelope = {
  profile: string;
  author: Record<string, unknown>;
  posts: ExportPost[];
};

export type ChunkIndexV1 = {
  format: "ampoose-post-chunks-v1";
  createdAt: string;
  collectionId: string;
  folderNames: string[];
  runId: number;
  chunkPrefix: string;
  totalPosts: number;
  partFiles: string[];
};

export type FsSessionStatus = "running" | "paused" | "done" | "error";

export type FsSessionCheckpointV1 = {
  format: "ampoose-fs-session-v1";
  version: 1;
  collectionId: string;
  folderNames: string[];
  createdAt: string;
  updatedAt: string;
  profileUrl: string;
  author: Record<string, unknown>;
  totalPosts: number;
  nextCursor: string | null;
  status: FsSessionStatus;
  lastError: string | null;
};

export type GraphqlArtifactEntry = {
  queryName: string;
  docId: string;
  variables: Record<string, unknown>;
  requestParams?: Record<string, string>;
  preload: unknown[];
};

export type GraphqlArtifactV1 = {
  schemaVersion: 1;
  updatedAt: string;
  count: number;
  names: string[];
  entries: Record<string, GraphqlArtifactEntry>;
};

export type RunStep = "START" | "DOWNLOADING" | "DONE";

export type RunProgress = {
  cursor: string | null;
  nextCursor: string | null;
  lastBatchCount: number;
  pagesFetched: number;
  duplicateStreak: number;
  totalPosts: number;
};

export type ResumeCursorRecord = {
  cursor: string;
  timestamp: number;
};

export type ResumeTransferPayloadV1 = {
  format: "ampoose-resume-cursors-v1";
  version: 1;
  collectionId: string;
  exportedAt: number;
  resumeCursors: Record<string, ResumeCursorRecord>;
};
