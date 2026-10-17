import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PresenceTracker, selectPresence } from '../src/presence.js';

describe('selectPresence', () => {
  it('sem guilds tocando = sem presença', () => {
    expect(selectPresence(new Map())).toBeNull();
  });

  it('escolhe a faixa que começou mais recentemente', () => {
    const playing = new Map([
      ['g1', { title: 'antiga', startedAt: 100 }],
      ['g2', { title: 'nova', startedAt: 200 }],
      ['g3', { title: 'meio', startedAt: 150 }],
    ]);
    expect(selectPresence(playing)).toBe('nova');
  });
});

describe('PresenceTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function tracker() {
    const apply = vi.fn<(title: string | null) => void>();
    return { apply, presence: new PresenceTracker({ apply, minIntervalMs: 5_000, now: () => Date.now() }) };
  }

  it('aplica a primeira mudança logo e agrupa as seguintes no intervalo mínimo', () => {
    const { apply, presence } = tracker();
    presence.started('g1', 'A');
    vi.advanceTimersByTime(0);
    expect(apply.mock.calls).toEqual([['A']]);

    presence.started('g1', 'B');
    presence.started('g1', 'C');
    vi.advanceTimersByTime(4_999);
    expect(apply).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(apply.mock.calls).toEqual([['A'], ['C']]);
  });

  it('troca de faixa (finished + started em seguida) não pisca a presença vazia', () => {
    const { apply, presence } = tracker();
    presence.started('g1', 'A');
    vi.advanceTimersByTime(10_000);
    presence.finished('g1');
    presence.started('g1', 'B');
    vi.advanceTimersByTime(10_000);
    expect(apply.mock.calls).toEqual([['A'], ['B']]);
  });

  it('com duas guilds, volta para a outra quando a mais recente para; limpa quando nenhuma toca', () => {
    const { apply, presence } = tracker();
    presence.started('g1', 'A');
    vi.advanceTimersByTime(10_000);
    presence.started('g2', 'B');
    vi.advanceTimersByTime(10_000);
    presence.finished('g2');
    vi.advanceTimersByTime(10_000);
    presence.finished('g1');
    vi.advanceTimersByTime(10_000);
    expect(apply.mock.calls).toEqual([['A'], ['B'], ['A'], [null]]);
  });

  it('não reaplica a mesma presença, mas refresh() força', () => {
    const { apply, presence } = tracker();
    presence.started('g1', 'A');
    vi.advanceTimersByTime(10_000);
    presence.finished('g9');
    presence.started('g1', 'A');
    vi.advanceTimersByTime(10_000);
    expect(apply).toHaveBeenCalledTimes(1);
    presence.refresh();
    vi.advanceTimersByTime(10_000);
    expect(apply.mock.calls).toEqual([['A'], ['A']]);
  });
});
