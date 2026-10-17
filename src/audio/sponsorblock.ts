import { createHash } from 'node:crypto';
import type { Segment } from './filters.js';

/**
 * SponsorBlock, categoria `music_offtopic` (trechos sem música em clipes: intros, falas, cenas).
 * Consulta com k-anonimato: só os 4 primeiros caracteres do SHA-256 do ID saem do servidor; a
 * filtragem pelo ID é local. Nunca lança: falha = tocar sem cortes (ADR-039).
 */

const CATEGORY = 'music_offtopic';
/** Cortes menores que isso não valem a emenda. */
const MIN_SEGMENT_SEC = 1;

export function hashPrefix(videoId: string): string {
  return createHash('sha256').update(videoId).digest('hex').slice(0, 4);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extrai os trechos do vídeo da resposta do endpoint por prefixo: valida, limita à duração,
 * ordena e junta sobreposições. Se os cortes cobrirem quase tudo, ignora (dado suspeito).
 */
export function parseSegments(body: unknown, videoId: string, durationSec: number | null): Segment[] {
  if (!Array.isArray(body)) return [];
  const raw: Segment[] = [];
  for (const video of body) {
    if (!isRecord(video) || video['videoID'] !== videoId || !Array.isArray(video['segments'])) continue;
    for (const item of video['segments']) {
      if (!isRecord(item) || item['category'] !== CATEGORY) continue;
      if (item['actionType'] !== undefined && item['actionType'] !== 'skip') continue;
      const range = item['segment'];
      if (!Array.isArray(range) || range.length !== 2) continue;
      const [start, end] = range;
      if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) continue;
      const clampedEnd = durationSec !== null ? Math.min(end, durationSec) : end;
      const clampedStart = Math.max(0, start);
      if (clampedEnd - clampedStart >= MIN_SEGMENT_SEC) raw.push({ start: clampedStart, end: clampedEnd });
    }
  }

  raw.sort((a, b) => a.start - b.start);
  const merged: Segment[] = [];
  for (const segment of raw) {
    const last = merged[merged.length - 1];
    if (last && segment.start <= last.end) merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, segment.end) };
    else merged.push(segment);
  }

  if (durationSec !== null) {
    const removed = merged.reduce((total, segment) => total + segment.end - segment.start, 0);
    if (removed > durationSec * 0.8) return [];
  }
  return merged;
}

export type FetchFn = (url: string, init: { signal: AbortSignal }) => Promise<{ readonly status: number; json(): Promise<unknown> }>;

export interface SponsorBlockOptions {
  readonly apiUrl: string;
  readonly fetch: FetchFn;
  readonly timeoutMs?: number;
  readonly cacheTtlMs?: number;
  readonly maxCacheEntries?: number;
  readonly now?: () => number;
  readonly onError?: (error: unknown, videoId: string) => void;
}

export class SponsorBlockClient {
  private readonly cache = new Map<string, { readonly expiresAt: number; readonly segments: readonly Segment[] }>();
  private readonly inFlight = new Map<string, Promise<readonly Segment[]>>();
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly now: () => number;

  constructor(private readonly options: SponsorBlockOptions) {
    this.timeoutMs = options.timeoutMs ?? 1_500;
    this.cacheTtlMs = options.cacheTtlMs ?? 6 * 3_600_000;
    this.maxCacheEntries = options.maxCacheEntries ?? 500;
    this.now = options.now ?? Date.now;
  }

  /** Trechos já conhecidos (`null` = ainda não consultado ou expirado). */
  cached(videoId: string): readonly Segment[] | null {
    const entry = this.cache.get(videoId);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.cache.delete(videoId);
      return null;
    }
    return entry.segments;
  }

  /** Consulta (ou devolve do cache). Falha de rede/timeout = `[]`, sem cachear. */
  get(videoId: string, durationSec: number | null): Promise<readonly Segment[]> {
    const cached = this.cached(videoId);
    if (cached) return Promise.resolve(cached);
    const pending = this.inFlight.get(videoId);
    if (pending) return pending;
    const promise = this.request(videoId, durationSec).finally(() => this.inFlight.delete(videoId));
    this.inFlight.set(videoId, promise);
    return promise;
  }

  private async request(videoId: string, durationSec: number | null): Promise<readonly Segment[]> {
    const categories = encodeURIComponent(JSON.stringify([CATEGORY]));
    const url = `${this.options.apiUrl}/api/skipSegments/${hashPrefix(videoId)}?categories=${categories}`;
    try {
      const response = await this.options.fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      // 404 = nenhum vídeo com esse prefixo tem trechos: resposta válida.
      const segments = response.status === 404 ? [] : response.status === 200 ? parseSegments(await response.json(), videoId, durationSec) : null;
      if (segments === null) throw new Error(`SponsorBlock respondeu HTTP ${response.status}`);
      this.store(videoId, segments);
      return segments;
    } catch (error) {
      this.options.onError?.(error, videoId);
      return [];
    }
  }

  private store(videoId: string, segments: readonly Segment[]): void {
    this.cache.delete(videoId);
    this.cache.set(videoId, { expiresAt: this.now() + this.cacheTtlMs, segments });
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
