import type { ResumeCursorRecord, ResumeTransferPayloadV1 } from "@/domain/types";

export function buildResumeTransferPayload(
  collectionId: string,
  resumeCursors: Record<string, ResumeCursorRecord>,
  exportedAt = Date.now()
): ResumeTransferPayloadV1 {
  const normalized: Record<string, ResumeCursorRecord> = {};
  for (const [id, value] of Object.entries(resumeCursors)) {
    const cursor = typeof value.cursor === "string" ? value.cursor.trim() : "";
    if (!cursor) continue;
    normalized[id] = {
      cursor,
      timestamp: Number.isFinite(value.timestamp) ? value.timestamp : exportedAt
    };
  }

  return {
    format: "ampoose-resume-cursors-v1",
    version: 1,
    collectionId,
    exportedAt,
    resumeCursors: normalized
  };
}

export function normalizeImportedResumePayload(value: unknown): ResumeTransferPayloadV1 | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<ResumeTransferPayloadV1>;
  if (data.format !== "ampoose-resume-cursors-v1") return null;
  if (data.version !== 1) return null;
  if (typeof data.collectionId !== "string") return null;
  if (typeof data.exportedAt !== "number") return null;
  if (!data.resumeCursors || typeof data.resumeCursors !== "object") return null;

  const normalized = buildResumeTransferPayload(data.collectionId, data.resumeCursors as Record<string, ResumeCursorRecord>, data.exportedAt);
  return normalized;
}
