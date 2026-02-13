import { expect, it } from 'bun:test';
import { buildDownloadFilename } from '@/background/downloadPath';

it('should prefix files into Ampoose folder', () => {
    expect(buildDownloadFilename('posts.json')).toBe('Ampoose/posts.json');
    expect(buildDownloadFilename('some.username/posts.json')).toBe('Ampoose/some.username/posts.json');
    expect(buildDownloadFilename('run-1/posts.json')).toBe('Ampoose/run-1/posts.json');
});

it('should avoid duplicate Ampoose prefix and strip unsafe segments', () => {
    expect(buildDownloadFilename('Ampoose/posts.json')).toBe('Ampoose/posts.json');
    expect(buildDownloadFilename('../posts.json')).toBe('Ampoose/posts.json');
    expect(buildDownloadFilename('..\\posts.json')).toBe('Ampoose/posts.json');
});

it('should fall back to default filename when missing', () => {
    expect(buildDownloadFilename('')).toBe('Ampoose/posts.json');
    expect(buildDownloadFilename(undefined)).toBe('Ampoose/posts.json');
});
