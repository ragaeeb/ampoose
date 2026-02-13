import { describe, expect, it } from 'bun:test';
import { isPlainObject, pruneExportValue } from '@/shared/object';

describe('isPlainObject', () => {
    it('should detect plain objects', () => {
        expect(isPlainObject({})).toBe(true);
        expect(isPlainObject(Object.create(null))).toBe(true);
        expect(isPlainObject([])).toBe(false);
        expect(isPlainObject(new Date())).toBe(false);
        expect(isPlainObject(null)).toBe(false);
    });
});

describe('pruneExportValue', () => {
    it('should drop removed keys and prune empty objects', () => {
        const value = { keep: 1, drop: 2 };
        const pruned = pruneExportValue(value, { drop: true });
        expect(pruned).toEqual({ keep: 1 });

        const empty = pruneExportValue({ drop: 1 }, { drop: true });
        expect(empty).toBeUndefined();
    });

    it('should prune arrays and remove undefined entries', () => {
        const value = [{ drop: 1 }, { keep: 2 }];
        const pruned = pruneExportValue(value, { drop: true });
        expect(pruned).toEqual([{ keep: 2 }]);
    });

    it('should return undefined for falsy scalar values', () => {
        expect(pruneExportValue('', {})).toBeUndefined();
        expect(pruneExportValue(0, {})).toBeUndefined();
        expect(pruneExportValue(false, {})).toBeUndefined();
    });
});
