import { ComponentType, type APIButtonComponentWithCustomId, type MessageEditOptions } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { ControlPanels, controlRow, nextLoopMode, type EditableChannel } from '../src/interactions/controls.js';
import type { GuildPlayer } from '../src/player/GuildPlayer.js';
import type { LoopMode } from '../src/player/Queue.js';
import type { Track } from '../src/youtube/YouTubeService.js';

const GUILD = '123456789012345678';

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

function buttons(row: ReturnType<typeof controlRow>): APIButtonComponentWithCustomId[] {
  return row.toJSON().components.filter(
    (component): component is APIButtonComponentWithCustomId =>
      component.type === ComponentType.Button && 'custom_id' in component,
  );
}

/** Só o que o ControlPanels lê do player; o announce não é exercitado aqui. */
function fakePlayer(loopMode: LoopMode = 'off'): GuildPlayer {
  const fake: Pick<GuildPlayer, 'guildId' | 'loopMode' | 'isPaused'> = { guildId: GUILD, loopMode, isPaused: false };
  return fake as GuildPlayer;
}

function fakeChannel() {
  const edit = vi.fn((_id: string, _options: MessageEditOptions) => Promise.resolve());
  const channel: EditableChannel = { id: 'c1', messages: { edit } };
  const disabledIds = (): string[] =>
    edit.mock.calls
      .filter(([, options]) => JSON.stringify(options.components).includes('"disabled":true'))
      .map(([id]) => id);
  return { channel, edit, disabledIds };
}

describe('nextLoopMode', () => {
  it('cicla off → faixa → fila → off', () => {
    expect(nextLoopMode('off')).toBe('track');
    expect(nextLoopMode('track')).toBe('queue');
    expect(nextLoopMode('queue')).toBe('off');
  });
});

describe('controlRow', () => {
  it('quatro botões com ação + guild no customId', () => {
    expect(buttons(controlRow(GUILD, { paused: false, loopMode: 'off' })).map((b) => b.custom_id)).toEqual([
      `ctl:toggle:${GUILD}`,
      `ctl:skip:${GUILD}`,
      `ctl:loop:${GUILD}`,
      `ctl:stop:${GUILD}`,
    ]);
  });

  it('reflete pausa e loop', () => {
    const [toggle, , loop] = buttons(controlRow(GUILD, { paused: true, loopMode: 'track' }));
    expect(toggle?.label).toBe('Continuar');
    expect(loop?.label).toBe('Loop: faixa');
  });

  it('disabled desliga todos', () => {
    expect(buttons(controlRow(GUILD, { paused: false, loopMode: 'off' }, true)).every((b) => b.disabled)).toBe(true);
    expect(buttons(controlRow(GUILD, { paused: false, loopMode: 'off' })).some((b) => b.disabled)).toBe(false);
  });
});

describe('ControlPanels', () => {
  it('fim da faixa desabilita as mensagens anexadas, editando pelo canal', () => {
    const panels = new ControlPanels();
    const player = fakePlayer();
    const { channel, disabledIds } = fakeChannel();
    const a = track('A');

    panels.trackStarted(player, a, false);
    panels.attach(GUILD, a, channel, 'm1', 'off');
    panels.attach(GUILD, a, channel, 'm2', 'off');
    expect(panels.isActive(GUILD, 'm1')).toBe(true);
    expect(disabledIds()).toEqual([]);

    panels.trackFinished(player);
    expect(disabledIds()).toEqual(['m1', 'm2']);
    expect(panels.isActive(GUILD, 'm1')).toBe(false);
  });

  it('anexar mensagem de uma faixa que já acabou só desabilita', () => {
    const panels = new ControlPanels();
    const player = fakePlayer();
    const { channel, disabledIds } = fakeChannel();

    panels.trackStarted(player, track('A'), false);
    panels.trackFinished(player);
    panels.trackStarted(player, track('B'), false);
    panels.attach(GUILD, track('A'), channel, 'velha', 'off');

    expect(disabledIds()).toEqual(['velha']);
    expect(panels.isActive(GUILD, 'velha')).toBe(false);
  });

  it('mantém no máximo 5 mensagens por faixa; a mais antiga perde os botões', () => {
    const panels = new ControlPanels();
    const player = fakePlayer();
    const { channel, disabledIds } = fakeChannel();
    const a = track('A');

    panels.trackStarted(player, a, false);
    for (let i = 1; i <= 6; i++) panels.attach(GUILD, a, channel, `m${i}`, 'off');

    expect(disabledIds()).toEqual(['m1']);
    expect(panels.isActive(GUILD, 'm1')).toBe(false);
    expect(panels.isActive(GUILD, 'm6')).toBe(true);
  });

  it('falha ao editar (mensagem apagada) não lança', async () => {
    const panels = new ControlPanels();
    const player = fakePlayer();
    const edit = vi.fn(() => Promise.reject(new Error('Unknown Message')));
    const a = track('A');

    panels.trackStarted(player, a, false);
    panels.attach(GUILD, a, { id: 'c1', messages: { edit } }, 'm1', 'off');
    expect(() => panels.trackFinished(player)).not.toThrow();
    await Promise.resolve();
    expect(edit).toHaveBeenCalledTimes(1);
  });
});
