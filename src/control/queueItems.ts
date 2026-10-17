/**
 * Operações sobre itens da fila por ID estável (painel). O ID é convertido para posição e a
 * operação de posição de `playback.ts` faz o resto, no mesmo tick (sem janela para corrida com o
 * Discord). Item que não existe mais = recusa clara, sem efeito (ADR-044).
 */
import { audit, move, remove, skipTo } from './playback.js';
import type { Actor, ControllablePlayer, ControlResult } from './types.js';

export const ITEM_GONE = 'Essa faixa não está mais na fila (alguém mexeu nela agora). A lista foi atualizada.';

function gone(): ControlResult {
  return { ok: false, message: ITEM_GONE };
}

export function removeById(player: ControllablePlayer, actor: Actor, id: string): ControlResult {
  const position = player.queue.positionOf(id);
  return position === null ? gone() : remove(player, actor, position);
}

export function skipToById(player: ControllablePlayer, actor: Actor, id: string): ControlResult {
  const position = player.queue.positionOf(id);
  return position === null ? gone() : skipTo(player, actor, position);
}

/** Move `id` para antes de `beforeId` (`null` = para o fim). */
export function moveById(player: ControllablePlayer, actor: Actor, id: string, beforeId: string | null): ControlResult {
  const from = player.queue.positionOf(id);
  if (from === null) return gone();
  if (beforeId === id) return { ok: true, message: 'A faixa já está nessa posição.' };
  let to = player.queue.size;
  if (beforeId !== null) {
    const before = player.queue.positionOf(beforeId);
    if (before === null) return gone();
    // Tirar o item de cima desloca os de baixo uma posição para cima.
    to = before > from ? before - 1 : before;
  }
  if (to === from) {
    audit(actor, player.guildId, 'move-noop', { from });
    return { ok: true, message: 'A faixa já está nessa posição.' };
  }
  return move(player, actor, from, to);
}
