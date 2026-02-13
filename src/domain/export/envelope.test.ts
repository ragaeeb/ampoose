import { describe, expect, it } from 'bun:test';
import { buildExportEnvelope, extractAuthorFromPost, extractProfileUrlFromPost } from '@/domain/export/envelope';

describe('export envelope (extra)', () => {
    it('should extract profile url from multiple shapes', () => {
        expect(extractProfileUrlFromPost(null)).toBe('');
        expect(extractProfileUrlFromPost({ profile: 'https://example.com/me' })).toBe('https://example.com/me');
        expect(extractProfileUrlFromPost({ author: { profile: 'https://example.com/author' } })).toBe(
            'https://example.com/author',
        );
        expect(extractProfileUrlFromPost({ author: { profile: '' } })).toBe('');
    });

    it('should extract a cleaned author object', () => {
        expect(extractAuthorFromPost(null)).toEqual({});
        expect(extractAuthorFromPost({ author: null })).toEqual({});
        expect(extractAuthorFromPost({ author: { id: '1', name: 'A', profile: 'x' } })).toEqual({
            id: '1',
            name: 'A',
        });
    });

    it('should build an envelope with sanitized posts', () => {
        const envelope = buildExportEnvelope([
            { post_id: '1', content: 'hello', createdAt: 1, profile: 'p', author: { id: '1', name: 'A' } },
            { post_id: '2', content: '', profile: 'p' },
        ]);

        expect(envelope.profile).toBe('p');
        expect(envelope.posts.length).toBe(1);
        expect(envelope.posts[0]).toEqual({ content: 'hello', createdAt: 1, id: '1' });
    });
});
