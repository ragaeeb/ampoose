import { expect, it } from 'bun:test';
import { buildGraphqlArtifact } from '@/domain/calibration/artifact';
import {
    buildCollectionRelativeFilename,
    extractProfileIdFromUrl,
    extractProfileUsername,
    resolveCollectionContext,
    resolveCollectionFolderName,
} from '@/runtime/controller/collectionPath';

const createArtifactWithProfileId = (id: string) => {
    return buildGraphqlArtifact({
        ProfileCometTimelineFeedRefetchQuery: {
            docId: '123',
            preload: [],
            queryName: 'ProfileCometTimelineFeedRefetchQuery',
            variables: { id },
        },
    });
};

it('should prefer username from facebook.com/<username>', () => {
    const artifact = createArtifactWithProfileId('100026362418520');
    const context = resolveCollectionContext({
        artifact,
        currentUrl: 'https://www.facebook.com/some.username',
    });

    expect(context.folderName).toBe('some.username');
    expect(context.collectionId).toBe('100026362418520');
    expect(context.folderNames).toEqual(['some.username']);
});

it('should fall back to profile id when username is unavailable', () => {
    const artifact = createArtifactWithProfileId('100026362418520');
    const context = resolveCollectionContext({
        artifact,
        currentUrl: 'https://www.facebook.com/permalink.php?story_fbid=123',
    });

    expect(context.folderName).toBe('100026362418520');
    expect(context.collectionId).toBe('100026362418520');
});

it('should use URL id when artifact id is missing', () => {
    const context = resolveCollectionContext({
        artifact: null,
        currentUrl: 'https://www.facebook.com/profile.php?id=1000123456789',
    });

    expect(context.folderName).toBe('1000123456789');
    expect(context.collectionId).toBe('1000123456789');
    expect(extractProfileIdFromUrl('https://www.facebook.com/profile.php?id=1000123456789')).toBe('1000123456789');
});

it('should sanitize and namespace relative filenames', () => {
    expect(extractProfileUsername('https://www.facebook.com/permalink.php?story_fbid=1')).toBe('');
    expect(resolveCollectionFolderName(['some:user'], '')).toBe('some_user');
    expect(buildCollectionRelativeFilename('some:user', '../posts.json')).toBe('some_user/posts.json');
    expect(buildCollectionRelativeFilename('', undefined)).toBe('collection/posts.json');
});
