import { describe, expect, it } from 'bun:test';
import {
    buildCollectionRelativeFilename,
    extractProfileIdFromUrl,
    extractProfileUsername,
    resolveCollectionContext,
    resolveCollectionFolderName,
} from '@/runtime/controller/collectionPath';

describe('collection path (extra)', () => {
    it('should reject reserved and numeric usernames', () => {
        expect(extractProfileUsername('https://www.facebook.com/login')).toBe('');
        expect(extractProfileUsername('https://www.facebook.com/12345')).toBe('');
        expect(extractProfileUsername('https://www.facebook.com/some.user')).toBe('some.user');
        expect(extractProfileUsername('   ')).toBe('');
        expect(extractProfileUsername('https://www.facebook.com/')).toBe('');
    });

    it('should extract profile ids from query and people path', () => {
        expect(extractProfileIdFromUrl('https://www.facebook.com/profile.php?id=987')).toBe('987');
        expect(extractProfileIdFromUrl('https://www.facebook.com/people/name/654321/')).toBe('654321');
        expect(extractProfileIdFromUrl('not-a-url')).toBe('');
        expect(extractProfileIdFromUrl('')).toBe('');
        expect(extractProfileIdFromUrl('https://www.facebook.com/people/name/not-a-number/')).toBe('not-a-number');
    });

    it('should build a collection context with sanitized tokens', () => {
        const ctx = resolveCollectionContext({
            artifact: null,
            currentUrl: 'https://www.facebook.com/some.user',
        });
        expect(ctx.folderName).toBe('some.user');
        expect(ctx.collectionId).toBe('some.user');
    });

    it('should resolve a folder name from multiple folder tokens', () => {
        expect(resolveCollectionFolderName([' a ', 'b', '..', ''], '')).toBe('a_b');
        expect(resolveCollectionFolderName([], ' 123 ')).toBe('123');
    });

    it('should build safe relative filenames', () => {
        expect(buildCollectionRelativeFilename('Ampoose', '../posts.json')).toBe('Ampoose/posts.json');
        expect(buildCollectionRelativeFilename('bad|name', 'run-1/..\\posts.json')).toBe('bad_name/run-1/posts.json');
        expect(buildCollectionRelativeFilename('...', '')).toBe('collection/posts.json');
        expect(buildCollectionRelativeFilename('a\tb', '/./x.json')).toBe('a_b/x.json');
    });

    it('should sanitize decoded url segments and fallback from artifact id to url id', () => {
        const ctx = resolveCollectionContext({
            artifact: {
                count: 1,
                entries: {
                    ProfileCometTimelineFeedRefetchQuery: {
                        docId: '1',
                        preload: [],
                        queryName: 'ProfileCometTimelineFeedRefetchQuery',
                        variables: { id: '' },
                    },
                },
                names: ['ProfileCometTimelineFeedRefetchQuery'],
                schemaVersion: 1,
                updatedAt: new Date().toISOString(),
            },
            currentUrl: 'https://www.facebook.com/people/%E0%A4%A/654321/',
        });

        expect(ctx.profileId).toBe('654321');
        expect(ctx.collectionId).toBe('654321');
    });

    it('should normalize numeric ids and people-path fallbacks', () => {
        const ctx = resolveCollectionContext({
            artifact: {
                count: 1,
                entries: {
                    ProfileCometTimelineFeedRefetchQuery: {
                        docId: '1',
                        preload: [],
                        queryName: 'ProfileCometTimelineFeedRefetchQuery',
                        variables: { id: 42.9 },
                    },
                },
                names: ['ProfileCometTimelineFeedRefetchQuery'],
                schemaVersion: 1,
                updatedAt: new Date().toISOString(),
            },
            currentUrl: 'https://www.facebook.com/people/name//',
        });
        expect(ctx.profileId).toBe('42');
        expect(ctx.collectionId).toBe('42');
    });
});
