import type { ChunkIndexV1, ExportPost } from '@/domain/types';

export type ChunkState = {
    chunkSize: number;
    enabled: boolean;
    nextPart: number;
    partFiles: string[];
    totalFlushed: number;
    runId: number;
    prefix: string;
    lastAutoIndexSignature: string;
};

export type ChunkPart = {
    filename: string;
    posts: ExportPost[];
};

export function normalizeRunId(value: unknown): number {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
        return 0;
    }
    return Math.floor(num);
}

export function resolveChunkPrefix(runId: unknown): string {
    return `run-${String(normalizeRunId(runId)).padStart(6, '0')}`;
}

export function createChunkState(runId: unknown = 0, chunkSize = 500): ChunkState {
    const normalized = normalizeRunId(runId);
    return {
        chunkSize: Math.max(1, Math.floor(chunkSize)),
        enabled: false,
        lastAutoIndexSignature: '',
        nextPart: 1,
        partFiles: [],
        prefix: resolveChunkPrefix(normalized),
        runId: normalized,
        totalFlushed: 0,
    };
}

export function buildChunkPartFilename(state: ChunkState): string {
    return `posts-${state.prefix}-part-${String(Math.max(1, state.nextPart)).padStart(4, '0')}.json`;
}

export function buildChunkIndexFilename(state: ChunkState): string {
    return `posts-${state.prefix}-index.json`;
}

export function getChunkSignature(state: ChunkState): string {
    if (state.partFiles.length === 0) {
        return 'empty';
    }
    const tail = state.partFiles[state.partFiles.length - 1] ?? '';
    return `${state.partFiles.length}:${tail}:${state.totalFlushed}`;
}

export function flushPostsChunk(
    state: ChunkState,
    posts: ExportPost[],
    force: boolean,
): { state: ChunkState; parts: ChunkPart[]; remaining: ExportPost[] } {
    let remaining = [...posts];
    const parts: ChunkPart[] = [];

    while (remaining.length >= state.chunkSize || (force && remaining.length > 0)) {
        state.enabled = true;
        const take = force ? Math.min(state.chunkSize, remaining.length) : state.chunkSize;
        const payload = remaining.slice(0, take);
        remaining = remaining.slice(take);

        const filename = buildChunkPartFilename(state);
        state.nextPart += 1;
        state.partFiles.push(filename);
        state.totalFlushed += payload.length;
        parts.push({ filename, posts: payload });
    }

    return {
        parts,
        remaining,
        state,
    };
}

export function buildChunkIndex(
    state: ChunkState,
    input: {
        collectionId: string;
        folderNames: string[];
        totalPosts: number;
        createdAt?: string;
    },
): ChunkIndexV1 {
    return {
        chunkPrefix: state.prefix,
        collectionId: input.collectionId,
        createdAt: input.createdAt ?? new Date().toISOString(),
        folderNames: input.folderNames,
        format: 'ampoose-post-chunks-v1',
        partFiles: [...state.partFiles],
        runId: normalizeRunId(state.runId),
        totalPosts: Math.max(0, Math.floor(input.totalPosts)),
    };
}
