import { describe, expect, it, vi } from 'vitest';
import {
  buildAudioFilter,
  effectiveDuration,
  FILTER_NAMES,
  mediaPosition,
  plainPlan,
  type StreamPlan,
} from '../src/audio/filters.js';
import { hashPrefix, parseSegments, SponsorBlockClient, type FetchFn } from '../src/audio/sponsorblock.js';
import { Queue } from '../src/player/Queue.js';
import type { Track } from '../src/youtube/YouTubeService.js';

function plan(partial: Partial<StreamPlan>): StreamPlan {
  return { ...plainPlan(), ...partial };
}

describe('buildAudioFilter', () => {
  it('sem nada = sem -af', () => {
    expect(buildAudioFilter(plainPlan())).toBeNull();
    expect(buildAudioFilter(plainPlan(90))).toBeNull();
  });

  it('cada efeito sozinho', () => {
    expect(buildAudioFilter(plan({ filter: 'bassboost' }))).toBe('bass=g=8:f=110:w=0.6,alimiter=limit=0.95');
    expect(buildAudioFilter(plan({ filter: 'nightcore' }))).toBe('aresample=48000,asetrate=48000*1.25,aresample=48000');
    expect(buildAudioFilter(plan({ filter: '8d' }))).toBe('apulsator=hz=0.125');
    expect(buildAudioFilter(plan({ loudnorm: true }))).toBe('loudnorm=I=-16:TP=-1.5:LRA=11');
  });

  it('ordem: cortes → efeito → loudnorm', () => {
    expect(
      buildAudioFilter(plan({ segments: [{ start: 0, end: 12.5 }], filter: 'nightcore', loudnorm: true })),
    ).toBe(
      "aselect='not(between(t,0,12.5))',asetpts=N/SR/TB,aresample=48000,asetrate=48000*1.25,aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=11",
    );
  });

  it('depois de -ss os cortes são deslocados; os que já passaram somem; o que contém o início começa em 0', () => {
    const segments = [
      { start: 5, end: 10 },
      { start: 55, end: 70 },
      { start: 200, end: 230 },
    ];
    expect(buildAudioFilter(plan({ startSec: 60, segments }))).toBe(
      "aselect='not(between(t,0,10)+between(t,140,170))',asetpts=N/SR/TB",
    );
  });

  it('todos os filtros geram cadeia válida (sem vírgulas soltas)', () => {
    for (const filter of FILTER_NAMES) {
      const chain = buildAudioFilter(plan({ filter, loudnorm: true, segments: [{ start: 1, end: 2 }] }));
      expect(chain).not.toMatch(/,,|^,|,$/);
    }
  });
});

describe('mediaPosition', () => {
  it('sem cortes nem velocidade = início + tocado', () => {
    expect(mediaPosition(30, plainPlan())).toBe(30);
    expect(mediaPosition(30, plainPlan(100))).toBe(130);
  });

  it('pula os cortes', () => {
    const p = plan({ segments: [{ start: 0, end: 20 }, { start: 60, end: 90 }] });
    expect(mediaPosition(0, p)).toBe(20);
    expect(mediaPosition(10, p)).toBe(30);
    expect(mediaPosition(40, p)).toBe(90);
    expect(mediaPosition(41, p)).toBe(91);
  });

  it('nightcore anda 1,25× mais rápido', () => {
    expect(mediaPosition(40, plan({ filter: 'nightcore' }))).toBe(50);
  });

  it('seek dentro de um corte começa no fim dele', () => {
    expect(mediaPosition(5, plan({ startSec: 65, segments: [{ start: 60, end: 90 }] }))).toBe(95);
  });

  it('combina seek, cortes e velocidade', () => {
    const p = plan({ startSec: 10, filter: 'nightcore', segments: [{ start: 20, end: 30 }] });
    // 8 s tocados × 1,25 = 10 s de vídeo: 10→20, pula 20–30, e chega em 30.
    expect(mediaPosition(8, p)).toBe(30);
    expect(mediaPosition(16, p)).toBe(40);
  });
});

describe('effectiveDuration', () => {
  it('corte que vai até o fim encurta a faixa; corte no meio não', () => {
    expect(effectiveDuration(300, [{ start: 270, end: 300 }], 10)).toBe(270);
    expect(effectiveDuration(300, [{ start: 270, end: 295 }], 10)).toBe(270);
    expect(effectiveDuration(300, [{ start: 100, end: 120 }], 10)).toBe(300);
    expect(effectiveDuration(300, [], 10)).toBe(300);
  });
});

describe('Queue.peekNext', () => {
  const track = (id: string): Track => ({
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title: id,
    durationSec: 60,
    uploader: null,
    requestedBy: { id: '1', name: 't' },
  });

  it.each([
    ['off', ['B'], 'B'],
    ['off', [], null],
    ['track', ['B'], 'A'],
    ['queue', ['B'], 'B'],
    ['queue', [], 'A'],
  ] as const)('loop %s com fila %j → %s', (mode, rest, expected) => {
    const queue = new Queue();
    queue.add([track('A'), ...rest.map(track)]);
    queue.advance({ skip: false, drop: false });
    queue.loopMode = mode;
    expect(queue.peekNext()?.id ?? null).toBe(expected);
    // Mesmo resultado que o avanço natural.
    expect(queue.advance({ skip: false, drop: false })?.id ?? null).toBe(expected);
  });
});

describe('SponsorBlock — parse', () => {
  const ID = 'dQw4w9WgXcQ';

  it('prefixo do hash (k-anonimato)', () => {
    expect(hashPrefix(ID)).toBe('5f6b');
  });

  it('pega só o vídeo pedido e a categoria music_offtopic, ordena, junta sobreposições e limita à duração', () => {
    const body = [
      { videoID: 'outrovideo1', segments: [{ category: 'music_offtopic', actionType: 'skip', segment: [0, 10] }] },
      {
        videoID: ID,
        segments: [
          { category: 'music_offtopic', actionType: 'skip', segment: [200, 220] },
          { category: 'sponsor', actionType: 'skip', segment: [50, 60] },
          { category: 'music_offtopic', actionType: 'skip', segment: [0, 15] },
          { category: 'music_offtopic', actionType: 'skip', segment: [10, 20] },
          { category: 'music_offtopic', actionType: 'mute', segment: [100, 110] },
          { category: 'music_offtopic', actionType: 'skip', segment: [205, 999] },
          { category: 'music_offtopic', actionType: 'skip', segment: [30, 30.5] },
          { category: 'music_offtopic', segment: ['x', 40] },
        ],
      },
    ];
    expect(parseSegments(body, ID, 213)).toEqual([
      { start: 0, end: 20 },
      { start: 200, end: 213 },
    ]);
  });

  it('cortes cobrindo quase o vídeo todo são ignorados; resposta malformada = []', () => {
    const body = [{ videoID: ID, segments: [{ category: 'music_offtopic', segment: [0, 200] }] }];
    expect(parseSegments(body, ID, 213)).toEqual([]);
    expect(parseSegments({ erro: true }, ID, 213)).toEqual([]);
    expect(parseSegments(null, ID, 213)).toEqual([]);
  });
});

describe('SponsorBlockClient', () => {
  const ID = 'dQw4w9WgXcQ';
  const ok = (body: unknown) => ({ status: 200, json: () => Promise.resolve(body) });
  const body = [{ videoID: ID, segments: [{ category: 'music_offtopic', actionType: 'skip', segment: [0, 18] }] }];

  it('consulta pelo prefixo, cacheia e deduplica pedidos simultâneos', async () => {
    const fetch = vi.fn<FetchFn>(() => Promise.resolve(ok(body)));
    const client = new SponsorBlockClient({ apiUrl: 'https://sb.example', fetch });
    expect(client.cached(ID)).toBeNull();
    const [a, b] = await Promise.all([client.get(ID, 213), client.get(ID, 213)]);
    expect(a).toEqual([{ start: 0, end: 18 }]);
    expect(b).toBe(a);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://sb.example/api/skipSegments/5f6b?categories=%5B%22music_offtopic%22%5D');
    expect(client.cached(ID)).toEqual([{ start: 0, end: 18 }]);
    await client.get(ID, 213);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('404 = sem cortes (cacheado)', async () => {
    const fetch = vi.fn<FetchFn>(() => Promise.resolve({ status: 404, json: () => Promise.reject(new Error('sem corpo')) }));
    const client = new SponsorBlockClient({ apiUrl: 'https://sb.example', fetch });
    await expect(client.get(ID, 213)).resolves.toEqual([]);
    expect(client.cached(ID)).toEqual([]);
  });

  it('erro, timeout ou HTTP inesperado = [] sem cachear, e avisa', async () => {
    const onError = vi.fn();
    const responses = [Promise.reject(new Error('timeout')), Promise.resolve({ status: 500, json: () => Promise.resolve(null) })];
    const fetch = vi.fn<FetchFn>(() => responses.shift() ?? Promise.resolve(ok(body)));
    const client = new SponsorBlockClient({ apiUrl: 'https://sb.example', fetch, onError });
    await expect(client.get(ID, 213)).resolves.toEqual([]);
    await expect(client.get(ID, 213)).resolves.toEqual([]);
    expect(client.cached(ID)).toBeNull();
    expect(onError).toHaveBeenCalledTimes(2);
    await expect(client.get(ID, 213)).resolves.toEqual([{ start: 0, end: 18 }]);
  });

  it('cache expira no TTL', async () => {
    let now = 0;
    const fetch = vi.fn<FetchFn>(() => Promise.resolve(ok(body)));
    const client = new SponsorBlockClient({ apiUrl: 'https://sb.example', fetch, cacheTtlMs: 1000, now: () => now });
    await client.get(ID, 213);
    now = 1000;
    expect(client.cached(ID)).toBeNull();
  });
});
