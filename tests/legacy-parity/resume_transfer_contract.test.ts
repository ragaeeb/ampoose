import { expect, it } from 'bun:test';
import { buildResumeTransferPayload, normalizeImportedResumePayload } from '../../src/domain/resume/transfer';

it('should match resume payload contract', () => {
    const payload = buildResumeTransferPayload(
        'collection-1',
        {
            a: { cursor: 'cursor-a', timestamp: 10 },
            b: { cursor: '   ', timestamp: 20 },
        },
        99,
    );

    expect(payload).toEqual({
        collectionId: 'collection-1',
        exportedAt: 99,
        format: 'ampoose-resume-cursors-v1',
        resumeCursors: {
            a: { cursor: 'cursor-a', timestamp: 10 },
        },
        version: 1,
    });

    expect(normalizeImportedResumePayload(payload)).toEqual(payload);
    expect(normalizeImportedResumePayload({ format: 'x' })).toBeNull();
});

it('should reject malformed imported payload shapes', () => {
    expect(normalizeImportedResumePayload(null)).toBeNull();
    expect(
        normalizeImportedResumePayload({
            collectionId: 'c1',
            exportedAt: 1,
            format: 'ampoose-resume-cursors-v1',
            resumeCursors: {},
            version: 2,
        }),
    ).toBeNull();
    expect(
        normalizeImportedResumePayload({
            collectionId: 123,
            exportedAt: 1,
            format: 'ampoose-resume-cursors-v1',
            resumeCursors: {},
            version: 1,
        }),
    ).toBeNull();
    expect(
        normalizeImportedResumePayload({
            collectionId: 'c1',
            exportedAt: '1',
            format: 'ampoose-resume-cursors-v1',
            resumeCursors: {},
            version: 1,
        }),
    ).toBeNull();
});
