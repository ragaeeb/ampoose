export type LogType = "info" | "warn" | "error";

export type LogEntry = {
  id: number;
  type: LogType;
  msg: string;
  payload?: unknown;
};

export const LOG_STORE_LIMIT = 1000;
export const LOG_PAYLOAD_LIMIT = 4000;

function truncateString(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 3))}...` : value;
}

export function normalizeLogPayload(payload: unknown): unknown {
  if (payload == null) return payload;

  const type = typeof payload;
  if (type === "string") return truncateString(payload as string, LOG_PAYLOAD_LIMIT);
  if (type === "number" || type === "boolean") return payload;

  if (payload instanceof Error) {
    return {
      name: payload.name,
      message: truncateString(payload.message, LOG_PAYLOAD_LIMIT),
      stack: truncateString(payload.stack ?? "", LOG_PAYLOAD_LIMIT)
    };
  }

  try {
    const seen = new WeakSet<object>();
    const serialized = JSON.stringify(payload, (_key, value: unknown) => {
      if (typeof value === "string") return truncateString(value, LOG_PAYLOAD_LIMIT);
      if (typeof value === "object" && value) {
        if (seen.has(value as object)) return "[Circular]";
        seen.add(value as object);
      }
      return value;
    });

    if (!serialized) return payload;
    if (serialized.length <= LOG_PAYLOAD_LIMIT) return JSON.parse(serialized) as unknown;
    return {
      truncated: true,
      preview: serialized.slice(0, LOG_PAYLOAD_LIMIT)
    };
  } catch {
    return {
      truncated: true,
      preview: "[payload unserializable]"
    };
  }
}

export class LogStore {
  private logs: LogEntry[] = [];

  add(type: LogType, msg: string, payload?: unknown): LogEntry {
    const entry: LogEntry = {
      id: Math.ceil(Math.random() * 9_999_999),
      type,
      msg,
      payload: normalizeLogPayload(payload)
    };
    this.logs.push(entry);
    if (this.logs.length > LOG_STORE_LIMIT) {
      this.logs = this.logs.slice(-LOG_STORE_LIMIT);
    }
    return entry;
  }

  getAll(): LogEntry[] {
    return [...this.logs];
  }

  clear() {
    this.logs = [];
  }
}
