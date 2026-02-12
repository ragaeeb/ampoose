import { describe, expect, it } from 'bun:test';
import { getMissingRequiredQueries, normalizeGraphqlArtifact } from '@/domain/calibration/artifact';

describe('normalizeGraphqlArtifact', () => {
    it('should return null for invalid inputs', () => {
        expect(normalizeGraphqlArtifact(null)).toBeNull();
        expect(normalizeGraphqlArtifact({})).toBeNull();
        expect(normalizeGraphqlArtifact('not-json')).toBeNull();
    });

    it('should parse stringified artifacts and normalize request params', () => {
        const input = JSON.stringify({
            schemaVersion: 1,
            updatedAt: '2020-01-01T00:00:00.000Z',
            entries: {
                ProfileCometTimelineFeedRefetchQuery: {
                    docId: '123',
                    preload: [],
                    queryName: 'ProfileCometTimelineFeedRefetchQuery',
                    requestParams: { keep: 'x', dropEmpty: '', dropNonString: 123 },
                    variables: { id: '456' },
                },
                BadEntry: { variables: { id: 'no-doc-id' } },
            },
        });

        const normalized = normalizeGraphqlArtifact(input);
        expect(normalized?.schemaVersion).toBe(1);
        expect(normalized?.names).toContain('ProfileCometTimelineFeedRefetchQuery');
        expect(normalized?.entries.ProfileCometTimelineFeedRefetchQuery?.requestParams).toEqual({ keep: 'x' });
        expect(normalized?.entries.BadEntry).toBeUndefined();
    });

    it('should drop non-object entries and accept numeric profile id variables', () => {
        const input = {
            schemaVersion: 1,
            entries: {
                ProfileCometTimelineFeedRefetchQuery: {
                    docId: '123',
                    preload: [],
                    variables: { id: 999 },
                },
                NotAnObject: 'nope',
            },
        };

        const normalized = normalizeGraphqlArtifact(input);
        expect(normalized?.entries.NotAnObject).toBeUndefined();
        expect(getMissingRequiredQueries(normalized)).toEqual([]);
    });
});

describe('getMissingRequiredQueries', () => {
    it('should report missing required queries for null artifact', () => {
        expect(getMissingRequiredQueries(null)).toContain('ProfileCometTimelineFeedRefetchQuery');
    });

    it('should require a profile id variable for the timeline query', () => {
        const artifact = normalizeGraphqlArtifact(
            JSON.stringify({
                schemaVersion: 1,
                entries: {
                    ProfileCometTimelineFeedRefetchQuery: {
                        docId: '123',
                        preload: [],
                        queryName: 'ProfileCometTimelineFeedRefetchQuery',
                        variables: { id: '' },
                    },
                },
            }),
        );

        expect(getMissingRequiredQueries(artifact)).toEqual(['ProfileCometTimelineFeedRefetchQuery']);
    });

    it('should accept a valid timeline entry with a profile id', () => {
        const artifact = normalizeGraphqlArtifact(
            JSON.stringify({
                schemaVersion: 1,
                entries: {
                    ProfileCometTimelineFeedRefetchQuery: {
                        docId: '123',
                        preload: [],
                        queryName: 'ProfileCometTimelineFeedRefetchQuery',
                        variables: { id: '999' },
                    },
                },
            }),
        );

        expect(getMissingRequiredQueries(artifact)).toEqual([]);
    });

    it('should treat required entries as missing when docId is absent', () => {
        const artifact = normalizeGraphqlArtifact(
            JSON.stringify({
                schemaVersion: 1,
                entries: {
                    ProfileCometTimelineFeedRefetchQuery: {
                        docId: '',
                        preload: [],
                        queryName: 'ProfileCometTimelineFeedRefetchQuery',
                        variables: { id: '999' },
                    },
                },
            }),
        );

        expect(getMissingRequiredQueries(artifact)).toEqual(['ProfileCometTimelineFeedRefetchQuery']);
    });
});
