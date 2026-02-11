import type { GraphqlRequestInput } from "@/domain/graphql/client";
import type { RuntimePost } from "@/runtime/controller/types";

const TIMELINE_QUERY_NAME = "ProfileCometTimelineFeedRefetchQuery";

type GraphqlRequester = {
  request: (input: GraphqlRequestInput) => Promise<unknown>;
};

type QueryInput = {
  cursor: string | null;
};

type TimelinePage = {
  nextCursor: string | null;
  posts: RuntimePost[];
};

type GraphqlError = {
  message: string;
  code?: string | number;
  severity?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function splitPath(path: string): string[] {
  return path.split(".");
}

function getByPath(source: unknown, path: string): unknown {
  const parts = splitPath(path);
  let current: unknown = source;

  for (const part of parts) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined;

    const arrayMatch = /^([^\[]+)\[(\d+)\]$/.exec(part);
    if (arrayMatch) {
      const key = arrayMatch[1] ?? "";
      const index = Number(arrayMatch[2]);
      if (!key) return undefined;
      if (!isRecord(current)) return undefined;
      const target = current[key];
      if (!Array.isArray(target)) return undefined;
      current = target[index];
      continue;
    }

    if (Array.isArray(current)) {
      const numeric = Number(part);
      if (Number.isInteger(numeric)) {
        current = current[numeric];
        continue;
      }
      return undefined;
    }

    current = current[part];
  }

  return current;
}

function firstPath(source: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const value = getByPath(source, path);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function normalizeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function normalizeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function getFirstNonNullFromList(list: unknown[], path: string): unknown {
  for (const entry of list) {
    const value = getByPath(entry, path);
    if (value != null) return value;
  }
  return undefined;
}

function getFirstPathMatch(target: unknown, paths: string[], fallback: unknown): unknown {
  for (const path of paths) {
    const value = getByPath(target, path);
    if (value) return value;
  }
  return fallback;
}

function resolveCreationTime(node: Record<string, unknown>): number {
  const primary = getByPath(
    node,
    "comet_sections.content.story.comet_sections.context_layout.story.comet_sections.metadata"
  );
  if (Array.isArray(primary)) {
    const createdAt = normalizeNumber(getFirstNonNullFromList(primary, "story.creation_time"));
    if (createdAt > 0) return createdAt;
  }

  const fallback = getByPath(node, "comet_sections.context_layout.story.comet_sections.metadata");
  if (Array.isArray(fallback)) {
    const createdAt = normalizeNumber(getFirstNonNullFromList(fallback, "story.creation_time"));
    if (createdAt > 0) return createdAt;
  }

  return 0;
}

function normalizePostNode(node: unknown): RuntimePost | null {
  if (!isRecord(node)) return null;

  const postId = normalizeString(node.post_id ?? node.id);
  if (!postId) return null;

  const story = (getByPath(node, "comet_sections.content.story") ?? {}) as Record<string, unknown>;
  const feedback = getFirstPathMatch(
    node,
    [
      "comet_sections.feedback.story.comet_feed_ufi_container.story.story_ufi_container.story.feedback_context.feedback_target_with_context.comet_ufi_summary_and_actions_renderer.feedback",
      "comet_sections.feedback.story.story_ufi_container.story.feedback_context.feedback_target_with_context.comet_ufi_summary_and_actions_renderer.feedback"
    ],
    {}
  );
  const actor = firstPath(node, [
    "comet_sections.context_layout.story.comet_sections.actor_photo.story.actors[0]",
    "comet_sections.content.story.comet_sections.context_layout.story.comet_sections.actor_photo.story.actors[0]"
  ]);

  const author = isRecord(actor)
    ? {
        id: normalizeString(actor.id),
        name: normalizeString(actor.name),
        profile: normalizeString(actor.profile_url)
      }
    : undefined;

  return {
    post_id: postId,
    storyId: normalizeString(node.id),
    content: normalizeString(
      firstPath(story, [
        "message.text",
        "comet_sections.message.story.message.text",
        "comet_sections.message_container.story.message.text"
      ]) ?? ""
    ),
    attachments: getByPath(story, "attachments"),
    url: normalizeString(getByPath(story, "wwwURL")),
    feedbackId: normalizeString(getByPath(story, "feedback.id") ?? getByPath(node, "feedback.id")),
    reactionsCount: normalizeNumber(getByPath(feedback, "reaction_count.count")),
    shareCount: normalizeNumber(getByPath(feedback, "share_count.count")),
    attached_story: isRecord(story.attached_story) ? story.attached_story : getByPath(node, "attached_story"),
    createdAt: resolveCreationTime(node),
    comments: [],
    attachmentsDetails: [],
    _attachments: [],
    _attachedStoryOriginal: getByPath(node, "attached_story"),
    author
  };
}

function toPayloadArray(response: unknown): unknown[] {
  if (Array.isArray(response)) return response;
  if (response === undefined || response === null) return [];
  return [response];
}

export function extractTimelinePageFromResponse(response: unknown): TimelinePage {
  const payloads = toPayloadArray(response);
  const nodes: unknown[] = [];
  for (const payload of payloads) {
    const edges = getByPath(payload, "data.node.timeline_list_feed_units.edges");
    if (Array.isArray(edges)) {
      for (const edge of edges) {
        const node = isRecord(edge) ? edge.node : undefined;
        if (node) nodes.push(node);
      }
      continue;
    }

    const single =
      getByPath(payload, "data.node.timeline_list_feed_units.edges[0].node") ??
      getByPath(payload, "data.node") ??
      undefined;
    if (single) nodes.push(single);
  }

  const pageInfoCandidate =
    firstPath({ payloads }, [
      "payloads[0].data.page_info",
      "payloads[0].data.node.timeline_list_feed_units.page_info"
    ]) ??
    (() => {
      for (const payload of payloads) {
        const direct = firstPath(payload, ["data.page_info", "data.node.timeline_list_feed_units.page_info"]);
        if (direct) return direct;
      }
      return undefined;
    })();

  const pageInfo = isRecord(pageInfoCandidate)
    ? {
        hasNextPage: Boolean(pageInfoCandidate.has_next_page),
        endCursor: normalizeString(pageInfoCandidate.end_cursor) || null
      }
    : { hasNextPage: false, endCursor: null as string | null };

  const dedup = new Set<string>();
  const posts: RuntimePost[] = [];

  for (const node of nodes) {
    const normalized = normalizePostNode(node);
    if (!normalized) continue;
    const postId = normalizeString(normalized.post_id);
    if (!postId || dedup.has(postId)) continue;
    dedup.add(postId);
    posts.push(normalized);
  }

  return {
    nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null,
    posts
  };
}

function extractGraphqlErrors(response: unknown): GraphqlError[] {
  const payloads = toPayloadArray(response);
  const errors: GraphqlError[] = [];

  for (const payload of payloads) {
    const list = getByPath(payload, "errors");
    if (!Array.isArray(list)) continue;

    for (const entry of list) {
      if (!isRecord(entry)) continue;
      const message = normalizeString(entry.message || entry.description || "");
      if (!message) continue;
      const next: GraphqlError = { message };
      const code = normalizeString(entry.code || "");
      const severity = normalizeString(entry.severity || "");
      if (code) next.code = code;
      if (severity) next.severity = severity;
      errors.push(next);
    }
  }

  return errors;
}

export async function queryProfileTimelinePage(client: GraphqlRequester, input: QueryInput): Promise<TimelinePage> {
  const requestInput: GraphqlRequestInput = input.cursor
    ? {
        queryName: TIMELINE_QUERY_NAME,
        variables: { cursor: input.cursor },
        responseMode: "all"
      }
    : { queryName: TIMELINE_QUERY_NAME, responseMode: "all" };
  const response = await client.request(requestInput);
  const page = extractTimelinePageFromResponse(response);
  if (page.posts.length === 0 && !page.nextCursor) {
    const errors = extractGraphqlErrors(response);
    if (errors.length > 0) {
      const summary = errors
        .slice(0, 3)
        .map((error) => `${error.code ? `[${error.code}] ` : ""}${error.message}`)
        .join(" | ");
      throw new Error(`timeline query returned GraphQL errors: ${summary}`);
    }
  }
  return page;
}
