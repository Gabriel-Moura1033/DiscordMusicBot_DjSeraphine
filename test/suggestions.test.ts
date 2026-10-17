import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { looksLikeUrl, normalizeQuery, SuggestionProvider, type Suggestion } from '../src/interactions/suggestions.js';

const DEBOUNCE = 350;
const WAIT = 2_000;
const TTL = 600_000;

function result(query: string): Suggestion[] {
  return [{ name: `resultado ${query}`, value: `https://www.youtube.com/watch?v=${'a'.repeat(11)}` }];
}

/** Busca falsa controlada pelo teste: cada chamada fica pendente até `resolve`/`reject`. */
function fakeSearch() {
  const pending = new Map<string, { resolve: (value: Suggestion[]) => void; reject: (error: Error) => void }>();
  const search = vi.fn(
    (query: string) =>
      new Promise<Suggestion[]>((resolve, reject) => {
        pending.set(query, { resolve, reject });
      }),
  );
  return {
    search,
    resolve: (query: string) => pending.get(query)?.resolve(result(query)),
    reject: (query: string) => pending.get(query)?.reject(new Error('yt-dlp falhou')),
  };
}

function provider(search: (query: string) => Promise<Suggestion[]>, maxConcurrent = 2) {
  return new SuggestionProvider({ search, cacheTtlMs: TTL, debounceMs: DEBOUNCE, waitMs: WAIT, maxConcurrent });
}

describe('normalização', () => {
  it('normalizeQuery', () => {
    expect(normalizeQuery('  Daft   PUNK  ')).toBe('daft punk');
  });

  it.each(['https://youtu.be/x', 'youtube.com/watch?v=x', 'www.youtube.com/', 'youtu.be', 'http://example.com'])(
    'reconhece link: %s',
    (query) => {
      expect(looksLikeUrl(query)).toBe(true);
    },
  );

  it.each(['daft punk', 'ac/dc thunderstruck', 'mr. brightside'])('não é link: %s', (query) => {
    expect(looksLikeUrl(query)).toBe(false);
  });
});

describe('SuggestionProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('abaixo de 3 caracteres ou link: lista vazia sem buscar', async () => {
    const fake = fakeSearch();
    const suggestions = provider(fake.search);
    await expect(suggestions.suggest('u', 'ab')).resolves.toEqual([]);
    await expect(suggestions.suggest('u', 'https://youtu.be/dQw4w9WgXcQ')).resolves.toEqual([]);
    expect(fake.search).not.toHaveBeenCalled();
  });

  it('busca depois do debounce e responde com o resultado', async () => {
    const fake = fakeSearch();
    const pending = provider(fake.search).suggest('u', 'daft punk');
    await vi.advanceTimersByTimeAsync(DEBOUNCE - 1);
    expect(fake.search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.search).toHaveBeenCalledWith('daft punk');
    fake.resolve('daft punk');
    await expect(pending).resolves.toEqual(result('daft punk'));
  });

  it('tecla nova do mesmo usuário descarta a anterior (só uma busca)', async () => {
    const fake = fakeSearch();
    const suggestions = provider(fake.search);
    const first = suggestions.suggest('u', 'daft');
    await vi.advanceTimersByTimeAsync(100);
    const second = suggestions.suggest('u', 'daft punk');
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    await expect(first).resolves.toEqual([]);
    fake.resolve('daft punk');
    await expect(second).resolves.toEqual(result('daft punk'));
    expect(fake.search).toHaveBeenCalledTimes(1);
  });

  it('usuários diferentes não se atrapalham e buscas iguais são deduplicadas', async () => {
    const fake = fakeSearch();
    const suggestions = provider(fake.search);
    const a = suggestions.suggest('u1', 'daft punk');
    const b = suggestions.suggest('u2', 'Daft  Punk');
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    fake.resolve('daft punk');
    await expect(a).resolves.toEqual(result('daft punk'));
    await expect(b).resolves.toEqual(result('daft punk'));
    expect(fake.search).toHaveBeenCalledTimes(1);
  });

  it('cache: segunda consulta responde na hora, sem debounce nem busca; expira no TTL', async () => {
    const fake = fakeSearch();
    const suggestions = provider(fake.search);
    const first = suggestions.suggest('u', 'daft punk');
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    fake.resolve('daft punk');
    await first;

    await expect(suggestions.suggest('u', 'daft punk')).resolves.toEqual(result('daft punk'));
    expect(fake.search).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + TTL);
    const third = suggestions.suggest('u', 'daft punk');
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(fake.search).toHaveBeenCalledTimes(2);
    fake.resolve('daft punk');
    await third;
  });

  it('timeout: responde vazio, mas a busca termina e enche o cache', async () => {
    const fake = fakeSearch();
    const suggestions = provider(fake.search);
    const slow = suggestions.suggest('u', 'daft punk');
    await vi.advanceTimersByTimeAsync(DEBOUNCE + WAIT);
    await expect(slow).resolves.toEqual([]);

    fake.resolve('daft punk');
    await vi.advanceTimersByTimeAsync(0);
    await expect(suggestions.suggest('u', 'daft punk')).resolves.toEqual(result('daft punk'));
    expect(fake.search).toHaveBeenCalledTimes(1);
  });

  it('falha da busca vira lista vazia e não é cacheada', async () => {
    const fake = fakeSearch();
    const suggestions = provider(fake.search);
    const failing = suggestions.suggest('u', 'daft punk');
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    fake.reject('daft punk');
    await expect(failing).resolves.toEqual([]);

    const retry = suggestions.suggest('u', 'daft punk');
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(fake.search).toHaveBeenCalledTimes(2);
    fake.resolve('daft punk');
    await expect(retry).resolves.toEqual(result('daft punk'));
  });

  it('limite de buscas simultâneas: excedente responde vazio sem enfileirar', async () => {
    const fake = fakeSearch();
    const suggestions = provider(fake.search, 1);
    const a = suggestions.suggest('u1', 'daft punk');
    const b = suggestions.suggest('u2', 'radiohead');
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    await expect(b).resolves.toEqual([]);
    expect(fake.search).toHaveBeenCalledTimes(1);
    fake.resolve('daft punk');
    await a;

    const c = suggestions.suggest('u2', 'radiohead');
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(fake.search).toHaveBeenCalledTimes(2);
    fake.resolve('radiohead');
    await expect(c).resolves.toEqual(result('radiohead'));
  });

  it('busca que lança de forma síncrona também vira lista vazia', async () => {
    const suggestions = provider(() => {
      throw new Error('boom');
    });
    const pending = suggestions.suggest('u', 'daft punk');
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    await expect(pending).resolves.toEqual([]);
  });
});
