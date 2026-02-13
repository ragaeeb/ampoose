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
        expect(hasPostAttachments({ attachments: [{}] })).toBeTrue();
        expect(hasPostAttachments({ _attachments: [{}] })).toBeTrue();
        expect(hasPostAttachments({ attachmentsDetails: [{}] })).toBeTrue();
        expect(hasPostAttachments({ attachedStoryAttachments: [{}] })).toBeTrue();
        expect(hasPostAttachments({ attached_story: { any: 1 } })).toBeTrue();
        expect(hasPostAttachments({ _attachedStoryOriginal: { any: 1 } })).toBeTrue();
        expect(hasPostAttachments({ attachedStory: { any: 1 } })).toBeTrue();
        expect(hasPostAttachments({})).toBeFalse();
    });

    it('should filter out posts without id/content and keep text posts even with attachments', () => {
        expect(shouldExportPost({ content: '', post_id: '1' })).toBeFalse();
        expect(shouldExportPost({ attachments: [{}], content: 'hi', post_id: '1' })).toBeTrue();
        expect(shouldExportPost({ content: 'hi', post_id: '1' })).toBeTrue();
    });

    it('should build an export post with optional createdAt', () => {
        expect(sanitizeExportPost({ content: ' hello ', post_id: '1' })).toEqual({ content: 'hello', id: '1' });
        expect(sanitizeExportPost({ attachments: [{ id: 'a1' }], content: 'kept', post_id: '2' })).toEqual({
            content: 'kept',
            id: '2',
        });
        expect(sanitizeExportPost({ content: 'hello', createdAt: 123, post_id: '1' })).toEqual({
            content: 'hello',
            createdAt: 123,
            id: '1',
        });
    });
});
