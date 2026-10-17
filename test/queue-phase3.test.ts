import { describe, expect, it } from 'vitest';
import { History } from '../src/player/History.js';
import { Queue, type AdvanceOptions, type LoopMode } from '../src/player/Queue.js';
import type { Track } from '../src/youtube/YouTubeService.js';
import { parseTimestamp } from '../src/util/time.js';

function track(id: string): Track {
  return {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title: `Faixa ${id}`,
    durationSec: 60,
    uploader: null,
    requestedBy: { id: '1', name: 'tester' },
  };
}

const NATURAL: AdvanceOptions = { skip: false, drop: false };
const SKIP: AdvanceOptions = { skip: true, drop: false };
const DROP: AdvanceOptions = { skip: true, drop: true };

const ids = (queue: Queue): string[] => queue.upcoming.map((t) => t.id);

function playing(mode: LoopMode, ...rest: string[]): Queue {
  const queue = new Queue();
  queue.add([track('A'), ...rest.map((id) => track(id))]);
  queue.advance(NATURAL);
  queue.loopMode = mode;
  return queue;
}

describe('Queue — move', () => {
  it('move para frente, para trás e para a mesma posição', () => {
    const queue = playing('off', 'B', 'C', 'D', 'E');
    expect(queue.move(4, 1)?.id).toBe('E');
    expect(ids(queue)).toEqual(['E', 'B', 'C', 'D']);
    expect(queue.move(1, 4)?.id).toBe('E');
    expect(ids(queue)).toEqual(['B', 'C', 'D', 'E']);
    expect(queue.move(2, 2)?.id).toBe('C');
    expect(ids(queue)).toEqual(['B', 'C', 'D', 'E']);
  });

  it.each([
    [0, 1],
    [1, 0],
    [5, 1],
    [1, 5],
    [1.5, 2],
  ])('rejeita posições inválidas (%s → %s) sem mexer na fila', (from, to) => {
    const queue = playing('off', 'B', 'C', 'D', 'E');
    expect(queue.move(from, to)).toBeNull();
    expect(ids(queue)).toEqual(['B', 'C', 'D', 'E']);
  });

  it('não mexe na faixa atual', () => {
    const queue = playing('off', 'B', 'C');
    queue.move(2, 1);
    expect(queue.current?.id).toBe('A');
  });
});

describe('Queue — skipTo', () => {
  const modes: LoopMode[] = ['off', 'track', 'queue'];
  const positions = [1, 2, 3, 4];

  // /skipto n deve dar exatamente o mesmo resultado que n × /skip.
  it.each(modes.flatMap((mode) => positions.map((position) => [mode, position] as const)))(
    'loop %s, posição %i ≡ /skip repetido',
    (mode, position) => {
      const expected = playing(mode, 'B', 'C', 'D', 'E');
      for (let i = 0; i < position; i++) expected.advance(SKIP);

      const actual = playing(mode, 'B', 'C', 'D', 'E');
      expect(actual.prepareSkipTo(position)).toBe(position - 1);
      actual.advance(DROP);

      expect(actual.current?.id).toBe(expected.current?.id);
      expect(ids(actual)).toEqual(ids(expected));
    },
  );

  it('posição inválida não mexe na fila', () => {
    const queue = playing('queue', 'B', 'C');
    expect(queue.prepareSkipTo(0)).toBeNull();
    expect(queue.prepareSkipTo(3)).toBeNull();
    expect(ids(queue)).toEqual(['B', 'C']);
    expect(queue.current?.id).toBe('A');
  });
});

describe('Queue — clear', () => {
  it('limpa os próximos e mantém a atual e o loop', () => {
    const queue = playing('queue', 'B', 'C');
    queue.clearUpcoming();
    expect(queue.current?.id).toBe('A');
    expect(queue.size).toBe(0);
    expect(queue.loopMode).toBe('queue');
  });
});

describe('Queue — previous (addFront + drop)', () => {
  it.each(['off', 'track', 'queue'] as const)('loop %s: anterior toca, a atual vira a próxima, sem duplicar', (mode) => {
    const queue = playing(mode, 'B', 'C');
    queue.addFront([track('Z'), track('A')]);
    queue.advance(DROP);
    expect(queue.current?.id).toBe('Z');
    expect(ids(queue)).toEqual(['A', 'B', 'C']);
  });
});

describe('History', () => {
  it('mais recente primeiro, com tamanho máximo', () => {
    const history = new History(3);
    for (const id of ['A', 'B', 'C', 'D']) history.push(track(id));
    expect(history.entries.map((t) => t.id)).toEqual(['D', 'C', 'B']);
  });

  it('repetições seguidas (loop de faixa) contam uma vez; não seguidas contam', () => {
    const history = new History(10);
    for (const id of ['A', 'A', 'A', 'B', 'A']) history.push(track(id));
    expect(history.entries.map((t) => t.id)).toEqual(['A', 'B', 'A']);
  });

  it('pop retira a mais recente; vazio retorna null', () => {
    const history = new History(10);
    history.push(track('A'));
    history.push(track('B'));
    expect(history.pop()?.id).toBe('B');
    expect(history.pop()?.id).toBe('A');
    expect(history.pop()).toBeNull();
    expect(history.size).toBe(0);
  });
});

describe('parseTimestamp', () => {
  it.each([
    ['0', 0],
    ['45', 45],
    ['90', 90],
    ['0:00', 0],
    ['1:30', 90],
    ['01:30', 90],
    ['90:00', 5400],
    ['1:02:45', 3765],
    ['  2:05  ', 125],
  ] as const)('%j → %i', (raw, expected) => {
    expect(parseTimestamp(raw)).toBe(expected);
  });

  it.each(['', 'abc', '1:60', '1:5', '1:2:3', '-1:00', '1:00:60', '1::00', '1:00:00:00', '1.5', '1:30s', ':30'])(
    'rejeita %j',
    (raw) => {
      expect(parseTimestamp(raw)).toBeNull();
    },
  );
});
