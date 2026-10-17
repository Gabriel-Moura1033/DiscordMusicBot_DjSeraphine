import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { suggestionFor } from '../src/interactions/searchMenu.js';
import { SearchSessions } from '../src/interactions/searchSessions.js';
import type { TrackInfo } from '../src/youtube/YouTubeService.js';

describe('SearchSessions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('só o dono vê a sessão e ela só pode ser consumida uma vez', () => {
    const sessions = new SearchSessions<string>(60_000);
    sessions.create('k', 'dono', ['a', 'b'], () => undefined);
    expect(sessions.owner('k')).toBe('dono');
    expect(sessions.take('k')).toEqual(['a', 'b']);
    expect(sessions.take('k')).toBeNull();
    expect(sessions.owner('k')).toBeNull();
  });

  it('expira no prazo e avisa uma vez; consumida antes não avisa', () => {
    const sessions = new SearchSessions<string>(60_000);
    const expired = vi.fn();
    const consumed = vi.fn();
    sessions.create('k1', 'u', ['a'], expired);
    sessions.create('k2', 'u', ['b'], consumed);
    sessions.take('k2');
    vi.advanceTimersByTime(59_999);
    expect(sessions.owner('k1')).toBe('u');
    vi.advanceTimersByTime(1);
    expect(sessions.owner('k1')).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
    expect(consumed).not.toHaveBeenCalled();
    expect(sessions.size).toBe(0);
  });

  it('clear cancela os timers', () => {
    const sessions = new SearchSessions<string>(1_000);
    const expired = vi.fn();
    sessions.create('k', 'u', ['a'], expired);
    sessions.clear();
    vi.advanceTimersByTime(5_000);
    expect(expired).not.toHaveBeenCalled();
  });
});

describe('suggestionFor', () => {
  const base: TrackInfo = {
    id: 'dQw4w9WgXcQ',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up',
    durationSec: 213,
    uploader: 'Rick Astley',
  };

  it('usa a URL canônica como valor', () => {
    expect(suggestionFor(base)).toEqual({
      name: 'Never Gonna Give You Up — Rick Astley (3:33)',
      value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
  });

  it('corta títulos longos preservando canal e duração, sempre ≤ 100', () => {
    const { name } = suggestionFor({ ...base, title: 'x'.repeat(300) });
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith('— Rick Astley (3:33)')).toBe(true);
  });

  it('nunca passa de 100 mesmo com canal enorme', () => {
    const { name } = suggestionFor({ ...base, title: 'y'.repeat(300), uploader: 'z'.repeat(300), durationSec: null });
    expect(name.length).toBeLessThanOrEqual(100);
  });
});
