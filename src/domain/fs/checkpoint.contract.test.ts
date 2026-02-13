import { expect, it } from 'bun:test';
import { buildFsSessionCheckpoint } from '@/domain/fs/checkpoint';

it('should match fs checkpoint contract', () => {
    const checkpoint = buildFsSessionCheckpoint({
        author: { id: 'a1', name: 'Author' },
        collectionId: 'collection-1',
        createdAt: '2026-02-11T00:00:00.000Z',
        folderNames: ['folder-1'],
        lastError: null,
        nextCursor: 'cursor-123',
        profileUrl: 'https://www.facebook.com/author',
        status: 'running',
        totalPosts: 120,
        updatedAt: '2026-02-11T00:10:00.000Z',
    });

    expect(checkpoint).toEqual({
        author: { id: 'a1', name: 'Author' },
        collectionId: 'collection-1',
        createdAt: '2026-02-11T00:00:00.000Z',
        folderNames: ['folder-1'],
        format: 'ampoose-fs-session-v1',
        lastError: null,
        nextCursor: 'cursor-123',
        profileUrl: 'https://www.facebook.com/author',
        status: 'running',
        totalPosts: 120,
        updatedAt: '2026-02-11T00:10:00.000Z',
        version: 1,
    });
});
