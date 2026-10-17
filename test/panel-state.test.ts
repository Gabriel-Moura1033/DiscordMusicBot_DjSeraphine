import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuildSettings } from '../src/player/GuildSettings.js';
import { buildSnapshot, changeKey, StateHub, type SnapshotSource, type StatePlayer } from '../src/panel/state.js';
import { FakePlayer, GUILD_ID, track, VOICE_ID } from './support/fakes.js';

const settings: GuildSettings = { filter: 'nightcore', loopMode: 'queue', autoplay: true, volume: 70 };

function source(player: FakePlayer | undefined, now = () => Date.now()): SnapshotSource {
  return {
    guilds: () => [{ id: GUILD_ID, name: 'Bar' }],
    channelName: (_g, id) => (id === VOICE_ID ? 'Música' : null),
    player: () => player as StatePlayer | undefined,
    settings: () => settings,
    bot: () => ({ ready: true, user: 'DJ#1', startedAt: 0, ytdlpVersion: '2026', children: 2 }),
    now,
  };
}

describe('buildSnapshot', () => {
  it('fora do canal: mostra as configurações salvas da guild', () => {
    const [guild] = buildSnapshot(source(undefined)).guilds;
    expect(guild).toMatchObject({ status: 'disconnected', current: null, queue: [], loop: 'queue', volume: 70, autoplay: true, filter: 'nightcore', speed: 1.25 });
  });

  it('tocando: faixa, posição, fila com IDs estáveis e autoplay marcado', () => {
    const player = new FakePlayer(track('A'), [track('B'), { ...track('C'), autoplayFrom: 'A', requestedBy: { id: '9', name: 'DJ Seraphine' } }]);
    const [guild] = buildSnapshot(source(player)).guilds;
    expect(guild).toMatchObject({
      status: 'playing',
      voiceChannel: { id: VOICE_ID, name: 'Música' },
      textChannel: { id: 'txt', name: 'geral' },
      current: { qid: player.queue.currentId, id: 'A', title: 'Faixa A', requestedBy: 'tester', autoplay: false },
      positionSec: 42,
    });
    expect(guild?.queue.map((t) => [t.qid, t.id, t.requestedBy, t.autoplay])).toEqual([
      [player.queue.entries[0]?.id, 'B', 'tester', false],
      [player.queue.entries[1]?.id, 'C', 'Recomendado pela DJ Seraphine', true],
    ]);
    player.isPaused = true;
    expect(buildSnapshot(source(player)).guilds[0]?.status).toBe('paused');
    expect(buildSnapshot(source(new FakePlayer())).guilds[0]?.status).toBe('idle');
  });

  it('a chave de mudança ignora a posição corrente, mas não seek (streamGeneration) nem a fila', () => {
    const player = new FakePlayer(track('A'), [track('B')]);
    const base = changeKey(buildSnapshot(source(player)));
    player.nowPlaying = () => ({ track: track('A'), elapsedSec: 99, paused: false });
    expect(changeKey(buildSnapshot(source(player)))).toBe(base);
    player.streamGeneration++;
    const seeked = changeKey(buildSnapshot(source(player)));
    expect(seeked).not.toBe(base);
    player.queue.remove(1);
    expect(changeKey(buildSnapshot(source(player)))).not.toBe(seeked);
  });
});

describe('StateHub', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('publica só quando muda, reenvia a cada 5 s para corrigir a posição e poke força na hora', () => {
    const player = new FakePlayer(track('A'), [track('B')]);
    const hub = new StateHub(source(player), 1_000);
    const received = vi.fn();
    hub.subscribe(received);

    vi.advanceTimersByTime(1_000);
    expect(received).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3_000);
    expect(received).toHaveBeenCalledTimes(1);

    player.queue.remove(1);
    vi.advanceTimersByTime(1_000);
    expect(received).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(5_000);
    expect(received).toHaveBeenCalledTimes(3);

    hub.poke();
    expect(received).toHaveBeenCalledTimes(4);
    hub.stop();
  });
});
