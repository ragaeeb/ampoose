import type { FsSessionCheckpointV1, FsSessionStatus } from '@/domain/types';

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
        author: input.author,
        collectionId: input.collectionId,
        createdAt: input.createdAt,
        folderNames: input.folderNames,
        format: 'ampoose-fs-session-v1',
        lastError: input.lastError ?? null,
        nextCursor: input.nextCursor,
        profileUrl: input.profileUrl,
        status: input.status,
        totalPosts: Math.max(0, Math.floor(input.totalPosts)),
        updatedAt: input.updatedAt ?? new Date().toISOString(),
        version: 1,
    };
}
