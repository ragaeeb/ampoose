import type { GraphqlArtifactEntry, GraphqlArtifactV1 } from '@/domain/types';

export const CALIBRATION_STORAGE_KEY = 'fbpem-graphql-artifact-v1';
export const REQUIRED_QUERY_NAMES = ['ProfileCometTimelineFeedRefetchQuery'] as const;
export const OPTIONAL_QUERY_NAMES = ['CometSinglePostDialogContentQuery'] as const;

function hasProfileIdVariable(entry: GraphqlArtifactEntry): boolean {
    const raw = entry.variables.id;
    if (typeof raw === 'string') {
        return raw.trim().length > 0;
    }
    if (typeof raw === 'number') {
        return Number.isFinite(raw);
    }
    return false;
}

function normalizeRequestParams(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const out: Record<string, string> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        if (!key) {
            continue;
        }
        if (typeof raw !== 'string') {
            continue;
        }
        if (!raw) {
            continue;
        }
        out[key] = raw;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

function hasValidRequiredEntry(queryName: string, entry: GraphqlArtifactEntry | undefined): boolean {
    if (!entry || typeof entry.docId !== 'string' || !entry.docId || typeof entry.variables !== 'object') {
        return false;
    }
    if (queryName === 'ProfileCometTimelineFeedRefetchQuery') {
        return hasProfileIdVariable(entry);
    }
    return true;
}

function tryParseArtifactInput(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value;
    }
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function isGraphqlArtifactV1Like(value: unknown): value is Pick<GraphqlArtifactV1, 'schemaVersion' | 'entries' | 'updatedAt'> {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const data = value as Partial<GraphqlArtifactV1>;
    return data.schemaVersion === 1 && Boolean(data.entries) && typeof data.entries === 'object';
}

function normalizeArtifactEntry(name: string, entry: unknown): GraphqlArtifactEntry | null {
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    const typed = entry as Partial<GraphqlArtifactEntry>;
    if (typeof typed.docId !== 'string' || !typed.docId) {
        return null;
    }
    if (!typed.variables || typeof typed.variables !== 'object') {
        return null;
    }

    const normalizedEntry: GraphqlArtifactEntry = {
        docId: typed.docId,
        preload: Array.isArray(typed.preload) ? typed.preload : [],
        queryName: typeof typed.queryName === 'string' && typed.queryName ? typed.queryName : name,
        variables: typed.variables as Record<string, unknown>,
    };

    const requestParams = normalizeRequestParams((typed as Record<string, unknown>).requestParams);
    if (requestParams) {
        normalizedEntry.requestParams = requestParams;
    }
    return normalizedEntry;
}

function normalizeArtifactEntries(entriesLike: Record<string, unknown>): Record<string, GraphqlArtifactEntry> {
    const entries: Record<string, GraphqlArtifactEntry> = {};
    for (const [name, entry] of Object.entries(entriesLike)) {
        const normalized = normalizeArtifactEntry(name, entry);
        if (normalized) {
            entries[name] = normalized;
        }
    }
    return entries;
}

export function normalizeGraphqlArtifact(value: unknown): GraphqlArtifactV1 | null {
    const parsed = tryParseArtifactInput(value);
    if (!isGraphqlArtifactV1Like(parsed)) {
        return null;
    }

    const entries = normalizeArtifactEntries(parsed.entries as Record<string, unknown>);
    const names = Object.keys(entries);
    return {
        count: names.length,
        entries,
        names,
        schemaVersion: 1,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
}

export function buildGraphqlArtifact(entries: Record<string, GraphqlArtifactEntry>): GraphqlArtifactV1 {
    const names = Object.keys(entries);
    return {
        count: names.length,
        entries,
        names,
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
    };
}

export function getMissingRequiredQueries(artifact: GraphqlArtifactV1 | null): string[] {
    if (!artifact) {
        return [...REQUIRED_QUERY_NAMES];
    }
    return REQUIRED_QUERY_NAMES.filter((queryName) => {
        const entry = artifact.entries[queryName];
        return !hasValidRequiredEntry(queryName, entry);
    });
}
