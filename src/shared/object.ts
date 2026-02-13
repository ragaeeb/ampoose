export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Object.prototype.toString.call(value) === '[object Object]';
}

export function pruneExportValue(value: unknown, removeKeys: Record<string, true>): unknown {
    if (Array.isArray(value)) {
        const items = value.map((entry) => pruneExportValue(entry, removeKeys)).filter((entry) => entry !== undefined);
        return items.length === 0 ? undefined : items;
    }

    if (isPlainObject(value)) {
        const out: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value)) {
            if (removeKeys[key]) {
                continue;
            }
            const next = pruneExportValue(entry, removeKeys);
            if (next !== undefined) {
                out[key] = next;
            }
        }
        return Object.keys(out).length === 0 ? undefined : out;
    }

    if (!value) {
        return undefined;
    }
    return value;
}
