import type { FsSessionCheckpointV1, FsSessionStatus } from "@/domain/types";

export function buildFsSessionCheckpoint(input: {
  collectionId: string;
  folderNames: string[];
  createdAt: string;
  updatedAt?: string;
  profileUrl: string;
  author: Record<string, unknown>;
  totalPosts: number;
  nextCursor: string | null;
  status: FsSessionStatus;
  lastError?: string | null;
}): FsSessionCheckpointV1 {
  return {
    format: "ampoose-fs-session-v1",
    version: 1,
    collectionId: input.collectionId,
    folderNames: input.folderNames,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    profileUrl: input.profileUrl,
    author: input.author,
    totalPosts: Math.max(0, Math.floor(input.totalPosts)),
    nextCursor: input.nextCursor,
    status: input.status,
    lastError: input.lastError ?? null
  };
}
