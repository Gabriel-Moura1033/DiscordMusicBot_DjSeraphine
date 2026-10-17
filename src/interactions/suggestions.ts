/**
 * Sugestões do autocomplete do /play. O Discord dá 3 s para responder e manda uma requisição a
 * cada tecla; cada busca é um processo do yt-dlp e uma consulta ao YouTube a partir do nosso IP.
 * Por isso: debounce por usuário, cache com TTL, deduplicação, limite de buscas simultâneas e
 * timeout curto. Nunca lança: qualquer falha vira lista vazia.
 */

export interface Suggestion {
  readonly name: string;
  readonly value: string;
}

export type SearchFn = (query: string) => Promise<readonly Suggestion[]>;

export interface SuggestionOptions {
  readonly search: SearchFn;
  readonly cacheTtlMs: number;
  readonly debounceMs?: number;
  /** Quanto esperar a busca depois do debounce. Estourou: lista vazia, mas a busca continua e enche o cache. */
  readonly waitMs?: number;
  readonly maxConcurrent?: number;
  readonly maxCacheEntries?: number;
  readonly minLength?: number;
  readonly now?: () => number;
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly suggestions: readonly Suggestion[];
}

const NONE: readonly Suggestion[] = [];

export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Links não geram sugestão: o /play já entende o link direto. */
export function looksLikeUrl(query: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(query) || /^[\w-]+(\.[\w-]+)+\//.test(query) || /\byoutu\.?be\b/i.test(query);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SuggestionProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<readonly Suggestion[]>>();
  private readonly latestByUser = new Map<string, number>();
  private sequence = 0;
  private running = 0;

  private readonly search: SearchFn;
  private readonly cacheTtlMs: number;
  private readonly debounceMs: number;
  private readonly waitMs: number;
  private readonly maxConcurrent: number;
  private readonly maxCacheEntries: number;
  private readonly minLength: number;
  private readonly now: () => number;

  constructor(options: SuggestionOptions) {
    this.search = options.search;
    this.cacheTtlMs = options.cacheTtlMs;
    this.debounceMs = options.debounceMs ?? 350;
    this.waitMs = options.waitMs ?? 2_000;
    this.maxConcurrent = options.maxConcurrent ?? 2;
    this.maxCacheEntries = options.maxCacheEntries ?? 200;
    this.minLength = options.minLength ?? 3;
    this.now = options.now ?? Date.now;
  }

  async suggest(userId: string, raw: string): Promise<readonly Suggestion[]> {
    const query = normalizeQuery(raw);
    if (query.length < this.minLength || looksLikeUrl(query)) return NONE;

    const cached = this.fromCache(query);
    if (cached) return cached;

    const ticket = ++this.sequence;
    this.latestByUser.set(userId, ticket);
    await sleep(this.debounceMs);
    // Chegou outra tecla do mesmo usuário: o Discord já descartou esta requisição.
    if (this.latestByUser.get(userId) !== ticket) return NONE;
    this.latestByUser.delete(userId);

    const filled = this.fromCache(query);
    if (filled) return filled;
    // Limite de buscas simultâneas atingido: não enfileira, a próxima tecla tenta de novo.
    const search = this.inFlight.get(query) ?? this.start(query);
    if (!search) return NONE;

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<readonly Suggestion[]>((resolve) => {
      timer = setTimeout(() => resolve(NONE), this.waitMs);
    });
    try {
      return await Promise.race([search, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private start(query: string): Promise<readonly Suggestion[]> | null {
    if (this.running >= this.maxConcurrent) return null;
    this.running++;
    // Via then(): um throw síncrono da busca também cai no catch e libera o contador.
    const promise = Promise.resolve()
      .then(() => this.search(query))
      .then((suggestions) => {
        this.store(query, suggestions);
        return suggestions;
      })
      .catch(() => NONE)
      .finally(() => {
        this.running--;
        this.inFlight.delete(query);
      });
    this.inFlight.set(query, promise);
    return promise;
  }

  private fromCache(query: string): readonly Suggestion[] | null {
    const entry = this.cache.get(query);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.cache.delete(query);
      return null;
    }
    // Reinsere para manter a ordem do Map como LRU.
    this.cache.delete(query);
    this.cache.set(query, entry);
    return entry.suggestions;
  }

  private store(query: string, suggestions: readonly Suggestion[]): void {
    this.cache.delete(query);
    this.cache.set(query, { expiresAt: this.now() + this.cacheTtlMs, suggestions });
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
