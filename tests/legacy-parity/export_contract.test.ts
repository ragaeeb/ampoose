import { expect, test } from 'bun:test';
import { buildExportEnvelope, stringifyExportData } from '../../src/domain/export/envelope';

test('export contract: envelope keys and post whitelist', () => {
    const input = [
        {
            attachments: [],
            author: {
                avatar: 'https://cdn/avatar.jpg',
                id: 'a1',
                name: 'Author Name',
                profile: 'https://www.facebook.com/author',
            },
            content: ' hello ',
            createdAt: 123,
            post_id: 'p1',
        },
        {
            attachments: [{ id: 'raw-graph' }],
            content: 'has attachment',
            post_id: 'p2',
        },
        {
            content: '   ',
            post_id: 'p3',
        },
    ];

    const envelope = buildExportEnvelope(input);
    expect(Object.keys(envelope)).toEqual(['author', 'posts', 'profile']);
    expect(envelope.profile).toBe('https://www.facebook.com/author');
    expect(envelope.author).toEqual({ id: 'a1', name: 'Author Name' });
    expect(envelope.posts).toEqual([{ content: 'hello', createdAt: 123, id: 'p1' }]);

    const pretty = stringifyExportData(envelope);
    expect(pretty.includes('\n  "posts": [\n')).toBe(true);
});
