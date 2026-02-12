import { expect, test } from 'bun:test';
import { buildDownloadFilename } from '@/background/downloadPath';

test('download path prefixes files into Ampoose folder', () => {
    expect(buildDownloadFilename('posts.json')).toBe('Ampoose/posts.json');
    expect(buildDownloadFilename('some.username/posts.json')).toBe('Ampoose/some.username/posts.json');
    expect(buildDownloadFilename('run-1/posts.json')).toBe('Ampoose/run-1/posts.json');
});

test('download path avoids duplicate Ampoose prefix and strips unsafe segments', () => {
    expect(buildDownloadFilename('Ampoose/posts.json')).toBe('Ampoose/posts.json');
    expect(buildDownloadFilename('../posts.json')).toBe('Ampoose/posts.json');
    expect(buildDownloadFilename('..\\posts.json')).toBe('Ampoose/posts.json');
});

test('download path falls back to default filename when missing', () => {
    expect(buildDownloadFilename('')).toBe('Ampoose/posts.json');
    expect(buildDownloadFilename(undefined)).toBe('Ampoose/posts.json');
});
