import { describe, expect, it } from 'bun:test';
import { hasPostAttachments, resolvePostId, sanitizeExportPost, shouldExportPost } from '@/domain/export/sanitize';

describe('export sanitize', () => {
    it('should resolve post ids from strings and numbers', () => {
        expect(resolvePostId({ post_id: 'abc' })).toBe('abc');
        expect(resolvePostId({ id: 123 })).toBe('123');
        expect(resolvePostId({})).toBe('');
        expect(resolvePostId(null)).toBe('');
    });

    it('should detect attachments on multiple known fields', () => {
        expect(hasPostAttachments({ attachments: [{}] })).toBe(true);
        expect(hasPostAttachments({ _attachments: [{}] })).toBe(true);
        expect(hasPostAttachments({ attachmentsDetails: [{}] })).toBe(true);
        expect(hasPostAttachments({ attachedStoryAttachments: [{}] })).toBe(true);
        expect(hasPostAttachments({ attached_story: { any: 1 } })).toBe(true);
        expect(hasPostAttachments({ _attachedStoryOriginal: { any: 1 } })).toBe(true);
        expect(hasPostAttachments({ attachedStory: { any: 1 } })).toBe(true);
        expect(hasPostAttachments({})).toBe(false);
    });

    it('should filter out posts without id/content and keep text posts even with attachments', () => {
        expect(shouldExportPost({ post_id: '1', content: '' })).toBe(false);
        expect(shouldExportPost({ post_id: '1', content: 'hi', attachments: [{}] })).toBe(true);
        expect(shouldExportPost({ post_id: '1', content: 'hi' })).toBe(true);
    });

    it('should build an export post with optional createdAt', () => {
        expect(sanitizeExportPost({ post_id: '1', content: ' hello ' })).toEqual({ content: 'hello', id: '1' });
        expect(sanitizeExportPost({ post_id: '2', content: 'kept', attachments: [{ id: 'a1' }] })).toEqual({
            content: 'kept',
            id: '2',
        });
        expect(sanitizeExportPost({ post_id: '1', content: 'hello', createdAt: 123 })).toEqual({
            content: 'hello',
            createdAt: 123,
            id: '1',
        });
    });
});
