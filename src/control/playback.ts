/**
 * Operações de controle da reprodução e da fila, compartilhadas por slash commands, botões e
 * painel (Fase 7). Validam a entrada, alteram o player e devolvem a mensagem para o usuário; toda
 * ação com efeito gera log de auditoria com a origem.
 */
import { FILTER_LABELS, type FilterName } from '../audio/filters.js';
import { LOOP_LABELS } from '../commands/embeds.js';
import { logger } from '../logger.js';
import type { SeekResult } from '../player/GuildPlayer.js';
import type { LoopMode } from '../player/Queue.js';
import { formatDuration, trackLink } from '../util/format.js';
import { parseTimestamp } from '../util/time.js';
import type { Actor, ControllablePlayer, ControlResult, SlowHooks } from './types.js';

const BUSY = 'Estou trocando de faixa agora; tente de novo em instantes.';
const NOTHING_PLAYING = 'Não há nada tocando.';

function ok(message: string): ControlResult {
  return { ok: true, message };
}

function fail(message: string): ControlResult {
  return { ok: false, message };
}

export function audit(actor: Actor, guildId: string, action: string, details: Record<string, unknown> = {}): void {
  const who = actor.source === 'discord' ? { userId: actor.userId } : {};
  logger.info({ audit: true, source: actor.source, guildId, action, ...who, ...details }, 'control action');
}

/** Mensagem de erro de /seek, /replay ou /filtro (todos reabrem o stream); `null` = deu certo. */
export function seekFailureMessage(result: SeekResult): string | null {
  switch (result.status) {
    case 'ok':
      return null;
    case 'idle':
      return NOTHING_PLAYING;
    case 'busy':
      return BUSY;
    case 'superseded':
      return 'A faixa mudou (ou outro pedido de posição chegou) antes de eu terminar.';
    case 'failed':
      return `❌ Não consegui reabrir o áudio: ${result.error.userMessage}. A música continua de onde estava.`;
  }
}

export function pause(player: ControllablePlayer, actor: Actor): ControlResult {
  if (!player.pause()) return fail('Não há nada tocando (ou já está pausado).');
  audit(actor, player.guildId, 'pause');
  return ok('⏸️ Pausado. Use `/resume` para continuar.');
}

export function resume(player: ControllablePlayer, actor: Actor): ControlResult {
  if (!player.resume()) return fail('Não há nada pausado.');
  audit(actor, player.guildId, 'resume');
  return ok('▶️ Continuando.');
}

export function skip(player: ControllablePlayer, actor: Actor): ControlResult {
  const skipped = player.skip();
  if (!skipped) return fail(NOTHING_PLAYING);
  audit(actor, player.guildId, 'skip', { trackId: skipped.id });
  return ok(`⏭️ Pulei ${trackLink(skipped)}.`);
}

export function stop(player: ControllablePlayer, actor: Actor): ControlResult {
  player.stop();
  audit(actor, player.guildId, 'stop');
  return ok('⏹️ Parei a música e limpei a fila.');
}

/** Sai do canal e descarta a fila salva. */
export function leave(player: ControllablePlayer, actor: Actor): ControlResult {
  player.destroy('leave command', { discardQueue: true });
  audit(actor, player.guildId, 'leave');
  return ok('👋 Saí do canal de voz.');
}

export function clear(player: ControllablePlayer, actor: Actor): ControlResult {
  const count = player.queue.size;
  if (count === 0) return fail('A fila já está vazia.');
  player.queue.clearUpcoming();
  audit(actor, player.guildId, 'clear', { removed: count });
  return ok(`🧹 Removi ${count} faixa(s) da fila. A atual continua tocando.`);
}

function invalidPosition(player: ControllablePlayer): ControlResult {
  return fail(`Posição inválida. A fila tem ${player.queue.size} faixa(s).`);
}

export function remove(player: ControllablePlayer, actor: Actor, position: number): ControlResult {
  const removed = player.queue.remove(position);
  if (!removed) return invalidPosition(player);
  audit(actor, player.guildId, 'remove', { position, trackId: removed.id });
  return ok(`🗑️ Removi ${trackLink(removed)} da posição #${position}.`);
}

export function move(player: ControllablePlayer, actor: Actor, from: number, to: number): ControlResult {
  const moved = player.queue.move(from, to);
  if (!moved) return invalidPosition(player);
  audit(actor, player.guildId, 'move', { from, to, trackId: moved.id });
  return ok(`↕️ Movi ${trackLink(moved)} de #${from} para #${to}.`);
}

export function shuffle(player: ControllablePlayer, actor: Actor): ControlResult {
  if (player.queue.size < 2) return fail('Precisa de pelo menos 2 faixas na fila para embaralhar.');
  player.queue.shuffle();
  audit(actor, player.guildId, 'shuffle', { size: player.queue.size });
  return ok(`🔀 Embaralhei ${player.queue.size} faixas.`);
}

export function skipTo(player: ControllablePlayer, actor: Actor, position: number): ControlResult {
  const result = player.skipTo(position);
  if (result === 'busy') return fail(BUSY);
  if (!result) {
    const reason = player.queue.current ? `A fila tem ${player.queue.size} faixa(s).` : NOTHING_PLAYING;
    return fail(`Posição inválida. ${reason}`);
  }
  audit(actor, player.guildId, 'skipto', { position, trackId: result.track.id, skipped: result.skipped });
  const where = player.loopMode === 'queue' ? 'foram para o fim da fila' : 'saíram da fila';
  const note = result.skipped > 0 ? ` (${result.skipped} faixa(s) puladas ${where})` : '';
  return ok(`⏩ Pulando para ${trackLink(result.track)}${note}.`);
}

export function previous(player: ControllablePlayer, actor: Actor): ControlResult {
  const result = player.previous();
  if (result === 'busy') return fail(BUSY);
  if (!result) return fail('Não há faixas anteriores no histórico.');
  audit(actor, player.guildId, 'previous', { trackId: result.id });
  const restored = player.consumeRestoredCount();
  const note = restored > 0 ? `\n📂 Fila anterior com ${restored} faixa(s) restaurada — use /clear para descartar.` : '';
  return ok(`⏮️ Voltando para ${trackLink(result)}.${note}`);
}

/** `position`: segundos, ou texto `ss` / `mm:ss` / `hh:mm:ss` (como digitado no /seek). */
export async function seek(
  player: ControllablePlayer,
  actor: Actor,
  position: string | number,
  hooks: SlowHooks = {},
): Promise<ControlResult> {
  const seconds = typeof position === 'number' ? position : parseTimestamp(position);
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return fail(`Tempo inválido: \`${String(position)}\`. Use \`mm:ss\` ou \`hh:mm:ss\` (ex.: \`1:30\`).`);
  }
  const track = player.queue.current;
  if (!track) return fail(NOTHING_PLAYING);
  if (track.durationSec !== null && seconds >= track.durationSec) {
    return fail(`A faixa tem ${formatDuration(track.durationSec)}; escolha um ponto antes disso.`);
  }

  await hooks.beforeSlow?.();
  const failure = seekFailureMessage(await player.seek(seconds));
  if (failure) return fail(failure);
  audit(actor, player.guildId, 'seek', { trackId: track.id, positionSec: seconds });
  return ok(`⏩ ${trackLink(track)} em \`${formatDuration(seconds)}\`.`);
}

export async function replay(player: ControllablePlayer, actor: Actor, hooks: SlowHooks = {}): Promise<ControlResult> {
  const track = player.queue.current;
  if (!track) return fail(NOTHING_PLAYING);
  await hooks.beforeSlow?.();
  const failure = seekFailureMessage(await player.seek(0));
  if (failure) return fail(failure);
  audit(actor, player.guildId, 'replay', { trackId: track.id });
  return ok(`🔄 Recomeçando ${trackLink(track)}.`);
}

export function setVolume(player: ControllablePlayer, actor: Actor, level: number): ControlResult {
  if (!Number.isInteger(level) || level < 0 || level > 100) return fail('Volume deve ser um inteiro de 0 a 100.');
  player.setVolume(level);
  audit(actor, player.guildId, 'volume', { level });
  return ok(`${level === 0 ? '🔇' : '🔊'} Volume: **${level}%**.`);
}

export function setLoop(player: ControllablePlayer, actor: Actor, mode: LoopMode): ControlResult {
  player.setLoop(mode);
  audit(actor, player.guildId, 'loop', { mode });
  return ok(`Loop: **${LOOP_LABELS[mode]}**.`);
}

export function setAutoplay(player: ControllablePlayer, actor: Actor, enabled: boolean): ControlResult {
  const removed = player.setAutoplay(enabled);
  audit(actor, player.guildId, 'autoplay', { enabled, removed });
  if (enabled) return ok('🤖 Autoplay **ligado**: quando a fila acabar, sigo com músicas relacionadas à última que tocou.');
  const note = removed > 0 ? ` Tirei ${removed} faixa(s) que ele tinha colocado na fila.` : '';
  return ok(`🤖 Autoplay **desligado**.${note}`);
}

export async function setFilter(
  player: ControllablePlayer,
  actor: Actor,
  filter: FilterName,
  hooks: SlowHooks = {},
): Promise<ControlResult> {
  const label = `**${FILTER_LABELS[filter]}**`;
  if (filter === player.filter) return fail(`O filtro já é ${label}.`);

  await hooks.beforeSlow?.();
  const result = await player.setFilter(filter);
  // O filtro fica salvo mesmo se reabrir falhar: a próxima faixa já sai com ele.
  audit(actor, player.guildId, 'filter', { filter, status: result.status });
  if (result.status === 'idle') return ok(`🎛️ Filtro ${label} salvo; vale a partir da próxima música.`);
  const failure = seekFailureMessage(result);
  if (failure) return fail(`${failure} O filtro ${label} vale a partir da próxima música.`);
  return ok(`🎛️ Filtro: ${label}.`);
}
