import { describe, expect, it, vi } from 'vitest';
import { Queue, type AdvanceOptions } from '../src/player/Queue.js';
import type { Track } from '../src/youtube/YouTubeService.js';

function track(id: string, durationSec: number | null = 60): Track {
  return {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title: `Faixa ${id}`,
    durationSec,
    uploader: null,
    requestedBy: { id: '1', name: 'tester' },
  };
}

const NATURAL: AdvanceOptions = { skip: false, drop: false };
const SKIP: AdvanceOptions = { skip: true, drop: false };
const DROP: AdvanceOptions = { skip: true, drop: true };

const ids = (queue: Queue): string[] => queue.upcoming.map((t) => t.id);

/** Fila tocando A com B, C, D na sequência. */
function playing(...rest: string[]): Queue {
  const queue = new Queue();
  queue.add([track('A'), ...rest.map((id) => track(id))]);
  queue.advance(NATURAL);
  return queue;
}

describe('Queue — add e estado', () => {
  it('começa vazia', () => {
    const queue = new Queue();
    expect(queue.current).toBeNull();
    expect(queue.size).toBe(0);
    expect(queue.loopMode).toBe('off');
    expect(queue.advance(NATURAL)).toBeNull();
  });

  it('add mantém a ordem e soma a duração', () => {
    const queue = new Queue();
    queue.add([track('A', 100), track('B', null), track('C', 20)]);
    expect(ids(queue)).toEqual(['A', 'B', 'C']);
    expect(queue.upcomingDuration).toEqual({ seconds: 120, unknown: 1 });
  });

  it('advance tira o primeiro e o torna atual', () => {
    const queue = playing('B');
    expect(queue.current?.id).toBe('A');
    expect(ids(queue)).toEqual(['B']);
  });
});

describe('Queue — remove', () => {
  it('remove por posição 1-based', () => {
    const queue = playing('B', 'C', 'D');
    expect(queue.remove(2)?.id).toBe('C');
    expect(ids(queue)).toEqual(['B', 'D']);
  });

  it.each([0, -1, 4, 1.5, Number.NaN])('posição inválida %s não altera a fila', (position) => {
    const queue = playing('B', 'C', 'D');
    expect(queue.remove(position)).toBeNull();
    expect(ids(queue)).toEqual(['B', 'C', 'D']);
  });

  it('não remove a faixa atual', () => {
    const queue = playing('B');
    queue.remove(1);
    expect(queue.current?.id).toBe('A');
    expect(queue.size).toBe(0);
  });
});

describe('Queue — shuffle', () => {
  it('embaralha só os próximos, de forma determinística com Math.random mockado', () => {
    const queue = playing('B', 'C', 'D', 'E');
    vi.spyOn(Math, 'random').mockReturnValue(0);
    queue.shuffle();
    // Fisher-Yates com random()=0 troca sempre com o índice 0.
    expect(ids(queue)).toEqual(['C', 'D', 'E', 'B']);
    expect(queue.current?.id).toBe('A');
  });

  it('é uma permutação (mesmos itens, mesmo tamanho)', () => {
    const queue = playing(...'BCDEFGHIJ'.split(''));
    queue.shuffle();
    expect([...ids(queue)].sort()).toEqual('BCDEFGHIJ'.split(''));
  });

  it('fila com 0 ou 1 item não quebra', () => {
    const queue = playing('B');
    queue.shuffle();
    expect(ids(queue)).toEqual(['B']);
  });
});

describe('Queue — loop', () => {
  it('off: avança e termina', () => {
    const queue = playing('B');
    expect(queue.advance(NATURAL)?.id).toBe('B');
    expect(queue.advance(NATURAL)).toBeNull();
    expect(queue.current).toBeNull();
  });

  it('track: repete a atual no fim natural', () => {
    const queue = playing('B');
    queue.loopMode = 'track';
    expect(queue.advance(NATURAL)?.id).toBe('A');
    expect(queue.advance(NATURAL)?.id).toBe('A');
    expect(ids(queue)).toEqual(['B']);
  });

  it('track: skip ignora o loop', () => {
    const queue = playing('B');
    queue.loopMode = 'track';
    expect(queue.advance(SKIP)?.id).toBe('B');
  });

  it('queue: a atual volta para o fim', () => {
    const queue = playing('B', 'C');
    queue.loopMode = 'queue';
    expect(queue.advance(NATURAL)?.id).toBe('B');
    expect(ids(queue)).toEqual(['C', 'A']);
    expect(queue.advance(SKIP)?.id).toBe('C');
    expect(ids(queue)).toEqual(['A', 'B']);
  });

  it('queue: com uma única faixa, ela se repete', () => {
    const queue = playing();
    queue.loopMode = 'queue';
    expect(queue.advance(NATURAL)?.id).toBe('A');
  });

  it('drop (falha ou /stop) não devolve a atual nem no loop de fila', () => {
    const queue = playing('B');
    queue.loopMode = 'queue';
    expect(queue.advance(DROP)?.id).toBe('B');
    expect(ids(queue)).toEqual([]);
  });

  it('drop no loop de faixa também avança (evita loop infinito em faixa quebrada)', () => {
    const queue = playing('B');
    queue.loopMode = 'track';
    expect(queue.advance(DROP)?.id).toBe('B');
  });
});

describe('Queue — clear e reset', () => {
  it('clearUpcoming mantém a atual', () => {
    const queue = playing('B', 'C');
    queue.clearUpcoming();
    expect(queue.current?.id).toBe('A');
    expect(queue.size).toBe(0);
  });

  it('reset zera tudo, inclusive o loop', () => {
    const queue = playing('B');
    queue.loopMode = 'queue';
    queue.reset();
    expect(queue.current).toBeNull();
    expect(queue.size).toBe(0);
    expect(queue.loopMode).toBe('off');
  });
});

describe('Queue — playnow (addFront + skip)', () => {
  it.each([
    ['off', ['B', 'C']],
    ['track', ['B', 'C']],
    ['queue', ['B', 'C', 'A']],
  ] as const)('loop %s: toca a pedida e preserva a fila', (mode, expected) => {
    const queue = playing('B', 'C');
    queue.loopMode = mode;
    queue.addFront([track('X')]);
    expect(queue.advance(SKIP)?.id).toBe('X');
    expect(ids(queue)).toEqual(expected);
  });

  it('playlist entra inteira na frente, em ordem', () => {
    const queue = playing('B');
    queue.addFront([track('P1'), track('P2'), track('P3')]);
    expect(queue.advance(SKIP)?.id).toBe('P1');
    expect(ids(queue)).toEqual(['P2', 'P3', 'B']);
  });
});
