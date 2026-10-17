import { describe, expect, it } from 'vitest';
import move from '../src/commands/move.js';
import remove from '../src/commands/remove.js';
import skipto from '../src/commands/skipto.js';
import type { Command, PlayerContext } from '../src/commands/types.js';
import { ITEM_GONE } from '../src/control/queueItems.js';
import type { GuildPlayer } from '../src/player/GuildPlayer.js';
import { runAction, type ActionDeps } from '../src/panel/actions.js';
import type { PanelAction } from '../src/panel/validation.js';
import { FakePlayer, fakeInteraction, GUILD_ID, track } from './support/fakes.js';

function deps(player: FakePlayer | undefined, announce = false): ActionDeps {
  return {
    players: {
      get: () => player as unknown as GuildPlayer | undefined,
      getOrCreate: () => Promise.reject(new Error('não usado')),
    },
    youtube: { resolve: () => Promise.reject(new Error('não usado')) },
    guild: () => undefined,
    announce,
  };
}

const playing = (...rest: string[]) => new FakePlayer(track('A'), rest.map((id) => track(id)));
const ids = (player: FakePlayer) => player.queue.upcoming.map((t) => t.id);
const qid = (player: FakePlayer, videoId: string) => {
  const entry = player.queue.entries.find((e) => e.track.id === videoId);
  if (!entry) throw new Error(`${videoId} não está na fila`);
  return entry.id;
};
const act = (player: FakePlayer | undefined, action: PanelAction, announce = false) => runAction(deps(player, announce), GUILD_ID, action);
const link = (id: string) => `[Faixa ${id}](https://www.youtube.com/watch?v=${id})`;

describe('operações por ID do item', () => {
  it('remove o item certo mesmo se a fila mudou pelo Discord no meio', async () => {
    const player = playing('B', 'C', 'D');
    const target = qid(player, 'C');
    // Alguém faz /move pelo Discord depois de a página carregar: C muda de posição.
    player.queue.move(3, 1);
    expect(ids(player)).toEqual(['D', 'B', 'C']);
    const result = await act(player, { type: 'remove', id: target });
    expect(result).toEqual({ ok: true, message: `🗑️ Removi ${link('C')} da posição #3.` });
    expect(ids(player)).toEqual(['D', 'B']);
  });

  it('item que já saiu: erro claro e nada muda', async () => {
    const player = playing('B', 'C');
    const gone = qid(player, 'B');
    player.queue.remove(1);
    expect(await act(player, { type: 'remove', id: gone })).toEqual({ ok: false, message: ITEM_GONE });
    expect(await act(player, { type: 'skipto', id: gone })).toEqual({ ok: false, message: ITEM_GONE });
    expect(await act(player, { type: 'move', id: gone, beforeId: null })).toEqual({ ok: false, message: ITEM_GONE });
    expect(await act(player, { type: 'move', id: qid(player, 'C'), beforeId: gone })).toEqual({ ok: false, message: ITEM_GONE });
    expect(ids(player)).toEqual(['C']);
  });

  it('move para antes de outro item (subindo e descendo) e para o fim', async () => {
    const player = playing('B', 'C', 'D', 'E');
    await act(player, { type: 'move', id: qid(player, 'D'), beforeId: qid(player, 'B') });
    expect(ids(player)).toEqual(['D', 'B', 'C', 'E']);
    await act(player, { type: 'move', id: qid(player, 'D'), beforeId: qid(player, 'E') });
    expect(ids(player)).toEqual(['B', 'C', 'D', 'E']);
    await act(player, { type: 'move', id: qid(player, 'B'), beforeId: null });
    expect(ids(player)).toEqual(['C', 'D', 'E', 'B']);
    expect(await act(player, { type: 'move', id: qid(player, 'C'), beforeId: qid(player, 'D') })).toEqual({
      ok: true,
      message: 'A faixa já está nessa posição.',
    });
    expect(ids(player)).toEqual(['C', 'D', 'E', 'B']);
  });

  it('skipto por ID', async () => {
    const player = playing('B', 'C', 'D');
    const result = await act(player, { type: 'skipto', id: qid(player, 'C') });
    expect(result.ok).toBe(true);
    expect(player.queue.current?.id).toBe('C');
    expect(ids(player)).toEqual(['D']);
  });

  it('IDs não mudam com reordenação, mas a faixa que volta no loop de fila ganha ID novo', () => {
    const player = playing('B', 'C');
    const before = player.queue.entries.map((e) => e.id);
    player.queue.move(2, 1);
    expect(player.queue.entries.map((e) => e.id)).toEqual([before[1], before[0]]);
    player.queue.loopMode = 'queue';
    const currentId = player.queue.currentId;
    player.queue.advance({ skip: false, drop: false });
    const requeued = player.queue.entries.at(-1);
    expect(requeued?.track.id).toBe('A');
    expect(requeued?.id).not.toBe(currentId);
    expect(player.queue.positionOf('q-inexistente')).toBeNull();
  });
});

describe('painel ≡ slash command', () => {
  async function viaCommand(command: Command, player: FakePlayer, options: Record<string, number>) {
    const { interaction, replies } = fakeInteraction(options);
    if (command.guard !== 'same-channel') throw new Error('fora do escopo');
    await command.execute({ interaction, services: {}, player } as unknown as PlayerContext);
    return replies.at(-1)?.content;
  }

  it.each([
    ['remove', remove, { posicao: 2 }, (p: FakePlayer): PanelAction => ({ type: 'remove', id: qid(p, 'C') })],
    ['skipto', skipto, { posicao: 2 }, (p: FakePlayer): PanelAction => ({ type: 'skipto', id: qid(p, 'C') })],
    ['move', move, { de: 3, para: 1 }, (p: FakePlayer): PanelAction => ({ type: 'move', id: qid(p, 'D'), beforeId: qid(p, 'B') })],
  ] as const)('%s', async (_name, command, options, action) => {
    const a = playing('B', 'C', 'D');
    const b = playing('B', 'C', 'D');
    const message = await viaCommand(command, a, options);
    const result = await act(b, action(b));
    expect(result.message).toBe(message);
    expect(b.queue.current?.id).toBe(a.queue.current?.id);
    expect(ids(b)).toEqual(ids(a));
  });
});

describe('fora do canal, avisos e casos especiais', () => {
  it('sem player: recusa as ações de reprodução', async () => {
    expect(await act(undefined, { type: 'skip' })).toEqual({ ok: false, message: 'Não estou em nenhum canal de voz.' });
    expect(await act(undefined, { type: 'add', query: 'x', mode: 'append' })).toEqual({
      ok: false,
      message: 'Conecte o bot a um canal de voz primeiro (Entrar).',
    });
  });

  it('PANEL_ANNOUNCE_ACTIONS: anuncia ações bem-sucedidas, não as recusadas', async () => {
    const player = playing('B');
    await act(player, { type: 'skip' }, true);
    await act(player, { type: 'volume', level: 30 }, true);
    await act(player, { type: 'resume' }, true);
    expect(player.sent).toEqual([`⏭️ Pulado via painel: ${link('A')}.`, '🔊 Volume 30% via painel.']);
  });

  it('sem PANEL_ANNOUNCE_ACTIONS: silêncio no canal', async () => {
    const player = playing('B');
    await act(player, { type: 'skip' }, false);
    expect(player.sent).toEqual([]);
  });

  it('sair anuncia antes de sair e descarta a fila salva', async () => {
    const player = playing('B');
    await act(player, { type: 'leave' }, true);
    expect(player.sent).toEqual(['👋 Saí do canal via painel.']);
    expect(player.calls).toEqual(['destroy:leave command:true']);
  });

  it('autoplay no mesmo estado não mexe na fila', async () => {
    const player = playing('B');
    expect(await act(player, { type: 'autoplay', enabled: false })).toEqual({ ok: true, message: '🤖 Autoplay já está desligado.' });
    expect(player.calls).toEqual([]);
  });
});
