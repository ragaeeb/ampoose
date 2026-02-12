import type { ExportPost } from '@/domain/types';
import { isPlainObject } from '@/shared/object';

export function resolvePostId(value: unknown): string {
    if (!isPlainObject(value)) {
        return '';
    }
    const raw = value.post_id ?? value.id;
    if (typeof raw === 'string') {
        return raw;
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return String(raw);
    }
    return '';
}

export function normalizePostContent(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function hasPostAttachments(value: unknown): boolean {
    if (!isPlainObject(value)) {
        return false;
    }
    const bag = value as Record<string, unknown>;
    return Boolean(
        (Array.isArray(bag.attachments) && bag.attachments.length > 0) ||
            (Array.isArray(bag._attachments) && bag._attachments.length > 0) ||
            (Array.isArray(bag.attachmentsDetails) && bag.attachmentsDetails.length > 0) ||
            (Array.isArray(bag.attachedStoryAttachments) && bag.attachedStoryAttachments.length > 0) ||
            (isPlainObject(bag.attached_story) && Object.keys(bag.attached_story).length > 0) ||
            (isPlainObject(bag._attachedStoryOriginal) && Object.keys(bag._attachedStoryOriginal).length > 0) ||
            (isPlainObject(bag.attachedStory) && Object.keys(bag.attachedStory).length > 0),
    );
}

export function shouldExportPost(value: unknown): boolean {
    if (!isPlainObject(value)) {
        return false;
    }
    const id = resolvePostId(value);
    if (!id) {
        return false;
    }
    const content = normalizePostContent(value.content);
    if (!content) {
        return false;
    }
    if (hasPostAttachments(value)) {
        return false;
    }
    return true;
}

export function sanitizeExportPost(value: unknown): ExportPost | undefined {
    if (!shouldExportPost(value)) {
        return undefined;
    }
    const id = resolvePostId(value);
    const obj = value as Record<string, unknown>;

    const output: ExportPost = {
        content: normalizePostContent(obj.content),
        id,
    };

    const createdAt = obj.createdAt;
    if (typeof createdAt === 'number' && Number.isFinite(createdAt)) {
        output.createdAt = createdAt;
    }

    return output;
}
