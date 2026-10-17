/**
 * Equivalência slash command × camada de controle (Fase 7): o painel chama `src/control/` direto;
 * aqui se prova que isso produz a mesma mensagem, a mesma classificação (ok/recusado) e o mesmo
 * estado da fila que o comando correspondente.
 */
import { describe, expect, it } from 'vitest';
import autoplay from '../src/commands/autoplay.js';
import clear from '../src/commands/clear.js';
import filtro from '../src/commands/filtro.js';
import leave from '../src/commands/leave.js';
import loop from '../src/commands/loop.js';
import move from '../src/commands/move.js';
import pause from '../src/commands/pause.js';
import previous from '../src/commands/previous.js';
import remove from '../src/commands/remove.js';
import replay from '../src/commands/replay.js';
import resume from '../src/commands/resume.js';
import seek from '../src/commands/seek.js';
import shuffle from '../src/commands/shuffle.js';
import skip from '../src/commands/skip.js';
import skipto from '../src/commands/skipto.js';
import stop from '../src/commands/stop.js';
import type { Command, PlayerContext } from '../src/commands/types.js';
import volume from '../src/commands/volume.js';
import * as control from '../src/control/playback.js';
import type { Actor, ControlResult } from '../src/control/types.js';
import { FakePlayer, fakeInteraction, track } from './support/fakes.js';

const PANEL: Actor = { source: 'painel' };

interface Case {
  readonly name: string;
  readonly command: Command;
  readonly options?: Record<string, string | number>;
  readonly setup: () => FakePlayer;
  readonly direct: (player: FakePlayer) => ControlResult | Promise<ControlResult>;
}

const playing = (...rest: string[]) => () => new FakePlayer(track('A'), rest.map((id) => track(id)));
const paused = () => {
  const player = new FakePlayer(track('A'));
  player.isPaused = true;
  return player;
};

const cases: Case[] = [
  { name: 'pause', command: pause, setup: playing(), direct: (p) => control.pause(p, PANEL) },
  { name: 'pause sem nada', command: pause, setup: () => new FakePlayer(), direct: (p) => control.pause(p, PANEL) },
  { name: 'resume', command: resume, setup: paused, direct: (p) => control.resume(p, PANEL) },
  { name: 'resume sem pausa', command: resume, setup: playing(), direct: (p) => control.resume(p, PANEL) },
  { name: 'skip', command: skip, setup: playing('B'), direct: (p) => control.skip(p, PANEL) },
  { name: 'skip sem nada', command: skip, setup: () => new FakePlayer(), direct: (p) => control.skip(p, PANEL) },
  { name: 'stop', command: stop, setup: playing('B'), direct: (p) => control.stop(p, PANEL) },
  { name: 'leave', command: leave, setup: playing('B'), direct: (p) => control.leave(p, PANEL) },
  { name: 'clear', command: clear, setup: playing('B', 'C'), direct: (p) => control.clear(p, PANEL) },
  { name: 'clear vazio', command: clear, setup: playing(), direct: (p) => control.clear(p, PANEL) },
  { name: 'remove', command: remove, options: { posicao: 2 }, setup: playing('B', 'C'), direct: (p) => control.remove(p, PANEL, 2) },
  { name: 'remove inválido', command: remove, options: { posicao: 9 }, setup: playing('B'), direct: (p) => control.remove(p, PANEL, 9) },
  { name: 'move', command: move, options: { de: 3, para: 1 }, setup: playing('B', 'C', 'D'), direct: (p) => control.move(p, PANEL, 3, 1) },
  { name: 'move inválido', command: move, options: { de: 0, para: 1 }, setup: playing('B'), direct: (p) => control.move(p, PANEL, 0, 1) },
  { name: 'shuffle curto', command: shuffle, setup: playing('B'), direct: (p) => control.shuffle(p, PANEL) },
  { name: 'skipto', command: skipto, options: { posicao: 2 }, setup: playing('B', 'C', 'D'), direct: (p) => control.skipTo(p, PANEL, 2) },
  { name: 'skipto inválido', command: skipto, options: { posicao: 7 }, setup: playing('B'), direct: (p) => control.skipTo(p, PANEL, 7) },
  {
    name: 'previous',
    command: previous,
    setup: () => Object.assign(new FakePlayer(track('A')), { previousResult: track('Z') }),
    direct: (p) => control.previous(p, PANEL),
  },
  { name: 'previous vazio', command: previous, setup: playing(), direct: (p) => control.previous(p, PANEL) },
  { name: 'seek', command: seek, options: { tempo: '1:30' }, setup: playing(), direct: (p) => control.seek(p, PANEL, '1:30') },
  { name: 'seek em segundos (painel)', command: seek, options: { tempo: '1:30' }, setup: playing(), direct: (p) => control.seek(p, PANEL, 90) },
  { name: 'seek inválido', command: seek, options: { tempo: 'abc' }, setup: playing(), direct: (p) => control.seek(p, PANEL, 'abc') },
  { name: 'seek além do fim', command: seek, options: { tempo: '9:00' }, setup: playing(), direct: (p) => control.seek(p, PANEL, 540) },
  { name: 'replay', command: replay, setup: playing(), direct: (p) => control.replay(p, PANEL) },
  { name: 'volume', command: volume, options: { nivel: 35 }, setup: playing(), direct: (p) => control.setVolume(p, PANEL, 35) },
  { name: 'loop', command: loop, options: { modo: 'track' }, setup: playing(), direct: (p) => control.setLoop(p, PANEL, 'track') },
  { name: 'autoplay', command: autoplay, setup: playing(), direct: (p) => control.setAutoplay(p, PANEL, !p.autoplay) },
  { name: 'filtro', command: filtro, options: { tipo: '8d' }, setup: playing(), direct: (p) => control.setFilter(p, PANEL, '8d') },
  { name: 'filtro repetido', command: filtro, options: { tipo: 'nenhum' }, setup: playing(), direct: (p) => control.setFilter(p, PANEL, 'nenhum') },
];

function state(player: FakePlayer) {
  return {
    current: player.queue.current?.id ?? null,
    upcoming: player.queue.upcoming.map((t) => t.id),
    loop: player.loopMode,
    paused: player.isPaused,
    volume: player.volume,
    filter: player.filter,
    autoplay: player.autoplay,
    destroyed: player.isDestroyed,
    calls: player.calls,
  };
}

describe('slash command ≡ camada de controle', () => {
  it.each(cases)('$name', async ({ command, options, setup, direct }) => {
    const viaCommand = setup();
    const { interaction, replies } = fakeInteraction(options);
    if (command.guard !== 'same-channel') throw new Error('fora do escopo');
    await command.execute({ interaction, services: {}, player: viaCommand } as unknown as PlayerContext);

    const viaControl = setup();
    const result = await direct(viaControl);

    const final = replies.filter((reply) => reply.kind !== 'defer').at(-1);
    expect(final?.content).toBe(result.message);
    // Recusa é efêmera (ou edição da resposta adiada); sucesso é público.
    const refused = final?.kind === 'deny' || (final?.kind === 'edit' && !result.ok);
    expect(refused).toBe(!result.ok);
    expect(state(viaControl)).toEqual(state(viaCommand));
  });

  it('shuffle embaralha o mesmo conjunto pelos dois caminhos', async () => {
    const viaCommand = playing('B', 'C', 'D')();
    const { interaction, replies } = fakeInteraction();
    if (shuffle.guard !== 'same-channel') throw new Error('fora do escopo');
    await shuffle.execute({ interaction, services: {}, player: viaCommand } as unknown as PlayerContext);
    const viaControl = playing('B', 'C', 'D')();
    const result = control.shuffle(viaControl, PANEL);
    expect(replies.at(-1)?.content).toBe(result.message);
    expect([...viaControl.queue.upcoming.map((t) => t.id)].sort()).toEqual([...viaCommand.queue.upcoming.map((t) => t.id)].sort());
  });
});
