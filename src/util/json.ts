export type JsonRecord = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getString(obj: JsonRecord, key: string): string | null {
  const value = obj[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function getNumber(obj: JsonRecord, key: string): number | null {
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function getRecords(obj: JsonRecord, key: string): JsonRecord[] {
  const value = obj[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function parseJsonRecord(text: string): JsonRecord | null {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}
