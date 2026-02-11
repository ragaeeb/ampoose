import type { ExportEnvelope, ExportPost } from "@/domain/types";
import { EXPORT_CONTRACT } from "@/domain/export/contract";
import { sanitizeExportPost } from "@/domain/export/sanitize";
import { isPlainObject, pruneExportValue } from "@/shared/object";

export function extractProfileUrlFromPost(value: unknown): string {
  if (!isPlainObject(value)) return "";
  if (typeof value.profile === "string" && value.profile) return value.profile;
  const author = value.author;
  if (!isPlainObject(author)) return "";
  return typeof author.profile === "string" ? author.profile : "";
}

export function extractAuthorFromPost(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return {};
  const author = value.author;
  if (!isPlainObject(author)) return {};
  const cleaned = pruneExportValue({ ...author }, EXPORT_CONTRACT.removePostKeys);
  return isPlainObject(cleaned) ? cleaned : {};
}

export function buildExportEnvelope(posts: unknown[]): ExportEnvelope {
  const profile = posts.map(extractProfileUrlFromPost).find(Boolean) ?? "";
  const author = posts
    .map(extractAuthorFromPost)
    .find((entry) => Object.keys(entry).length > 0) ?? {};

  const outputPosts: ExportPost[] = [];
  for (const post of posts) {
    const sanitized = sanitizeExportPost(post);
    if (sanitized) outputPosts.push(sanitized);
  }

  return {
    profile,
    author,
    posts: outputPosts
  };
}

export function stringifyExportData(payload: ExportEnvelope): string {
  return JSON.stringify(payload, null, 2);
}
