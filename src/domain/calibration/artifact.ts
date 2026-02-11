import type { GraphqlArtifactEntry, GraphqlArtifactV1 } from "@/domain/types";

export const CALIBRATION_STORAGE_KEY = "fbpem-graphql-artifact-v1";
export const REQUIRED_QUERY_NAMES = [
  "ProfileCometTimelineFeedRefetchQuery"
] as const;
export const OPTIONAL_QUERY_NAMES = ["CometSinglePostDialogContentQuery"] as const;

function hasProfileIdVariable(entry: GraphqlArtifactEntry): boolean {
  const raw = entry.variables.id;
  if (typeof raw === "string") return raw.trim().length > 0;
  if (typeof raw === "number") return Number.isFinite(raw);
  return false;
}

function normalizeRequestParams(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key) continue;
    if (typeof raw !== "string") continue;
    if (!raw) continue;
    out[key] = raw;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function hasValidRequiredEntry(queryName: string, entry: GraphqlArtifactEntry | undefined): boolean {
  if (!entry || typeof entry.docId !== "string" || !entry.docId || typeof entry.variables !== "object") return false;
  if (queryName === "ProfileCometTimelineFeedRefetchQuery") {
    return hasProfileIdVariable(entry);
  }
  return true;
}

export function normalizeGraphqlArtifact(value: unknown): GraphqlArtifactV1 | null {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object") return null;
  const data = parsed as Partial<GraphqlArtifactV1>;
  if (data.schemaVersion !== 1) return null;
  if (!data.entries || typeof data.entries !== "object") return null;

  const entries: Record<string, GraphqlArtifactEntry> = {};
  for (const [name, entry] of Object.entries(data.entries)) {
    if (!entry || typeof entry !== "object") continue;
    const typed = entry as Partial<GraphqlArtifactEntry>;
    if (typeof typed.docId !== "string" || !typed.docId) continue;
    if (!typed.variables || typeof typed.variables !== "object") continue;

    const normalizedEntry: GraphqlArtifactEntry = {
      queryName: typeof typed.queryName === "string" && typed.queryName ? typed.queryName : name,
      docId: typed.docId,
      variables: typed.variables as Record<string, unknown>,
      preload: Array.isArray(typed.preload) ? typed.preload : []
    };
    const requestParams = normalizeRequestParams((typed as Record<string, unknown>).requestParams);
    if (requestParams) normalizedEntry.requestParams = requestParams;
    entries[name] = normalizedEntry;
  }

  const names = Object.keys(entries);
  return {
    schemaVersion: 1,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
    count: names.length,
    names,
    entries
  };
}

export function buildGraphqlArtifact(entries: Record<string, GraphqlArtifactEntry>): GraphqlArtifactV1 {
  const names = Object.keys(entries);
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    count: names.length,
    names,
    entries
  };
}

export function getMissingRequiredQueries(artifact: GraphqlArtifactV1 | null): string[] {
  if (!artifact) return [...REQUIRED_QUERY_NAMES];
  return REQUIRED_QUERY_NAMES.filter((queryName) => {
    const entry = artifact.entries[queryName];
    return !hasValidRequiredEntry(queryName, entry);
  });
}
