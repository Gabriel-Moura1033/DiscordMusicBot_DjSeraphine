/**
 * Ações do painel: chama a MESMA camada de controle dos slash commands (src/control/), com origem
 * `painel`, sem a regra de "estar no canal de voz" (o dono controla de fora). Com
 * `PANEL_ANNOUNCE_ACTIONS`, cada ação bem-sucedida é anunciada no canal de texto da sessão.
 */
import { MessageFlags, type Guild, type GuildTextBasedChannel } from 'discord.js';
import { FILTER_LABELS } from '../audio/filters.js';
import { LOOP_LABELS } from '../commands/embeds.js';
import { PANEL_REQUESTER, requestPlay, type PlayDeps } from '../control/enqueue.js';
import * as control from '../control/playback.js';
import { moveById, removeById, skipToById } from '../control/queueItems.js';
import { join } from '../control/session.js';
import type { Actor, ControllablePlayer, ControlResult } from '../control/types.js';
import { logger } from '../logger.js';
import type { PlayerManager } from '../player/PlayerManager.js';
import { formatDuration, trackLink, truncate } from '../util/format.js';
import { parseInput } from '../youtube/url.js';
import type { PanelAction } from './validation.js';

export const PANEL_ACTOR: Actor = { source: 'painel' };
const NOT_CONNECTED = 'Não estou em nenhum canal de voz.';

/** O que o painel precisa do player além da camada de controle. */
export interface PanelPlayer extends ControllablePlayer {
  readonly voiceChannelId: string | null;
  textChannel: GuildTextBasedChannel;
}

export interface ActionDeps extends PlayDeps {
  readonly players: Pick<PlayerManager, 'get' | 'getOrCreate'>;
  readonly guild: (guildId: string) => Guild | undefined;
  readonly announce: boolean;
}

function fail(message: string): ControlResult {
  return { ok: false, message };
}

/** Texto do aviso no canal ("⏭️ Pulado via painel"); `null` = ação sem aviso. */
export function announcement(action: PanelAction, player: ControllablePlayer, detail: string | null): string | null {
  switch (action.type) {
    case 'pause':
      return '⏸️ Pausado via painel.';
    case 'resume':
      return '▶️ Retomado via painel.';
    case 'skip':
      return `⏭️ Pulado via painel${detail ? `: ${detail}` : ''}.`;
    case 'stop':
      return '⏹️ Parado via painel (fila limpa).';
    case 'leave':
      return '👋 Saí do canal via painel.';
    case 'shuffle':
      return '🔀 Fila embaralhada via painel.';
    case 'previous':
      return '⏮️ Voltei para a faixa anterior via painel.';
    case 'replay':
      return '🔄 Faixa recomeçada via painel.';
    case 'clear':
      return '🧹 Fila limpa via painel.';
    case 'volume':
      return `🔊 Volume ${action.level}% via painel.`;
    case 'loop':
      return `🔁 Loop: ${LOOP_LABELS[action.mode]} via painel.`;
    case 'seek':
      return `⏩ Posição ${formatDuration(action.positionSec)} via painel.`;
    case 'autoplay':
      return `🤖 Autoplay ${action.enabled ? 'ligado' : 'desligado'} via painel.`;
    case 'filter':
      return `🎛️ Filtro ${FILTER_LABELS[action.filter]} via painel.`;
    case 'add':
      return detail ? `➕ Adicionado via painel: ${detail}.` : null;
    case 'remove':
      return `🗑️ Removido da fila via painel${detail ? `: ${detail}` : ''}.`;
    case 'move':
      return '↕️ Fila reordenada via painel.';
    case 'skipto':
      return `⏩ Pulado até ${detail ?? 'outra faixa'} via painel.`;
    case 'join':
      return player.queue.current ? null : '👋 Entrei via painel.';
  }
}

async function announce(player: PanelPlayer, text: string): Promise<void> {
  try {
    await player.textChannel.send({ content: text, flags: MessageFlags.SuppressEmbeds, allowedMentions: { parse: [] } });
  } catch (error) {
    logger.warn({ err: error, guildId: player.guildId }, 'panel: announcement failed');
  }
}

/** Faixa referida por um ID, para o aviso (antes da operação, que pode tirá-la da fila). */
function itemLabel(player: ControllablePlayer, id: string): string | null {
  const entry = player.queue.entries.find((item) => item.id === id);
  return entry ? trackLink(entry.track, 60) : null;
}

async function add(deps: ActionDeps, guildId: string, player: PanelPlayer | undefined, action: Extract<PanelAction, { type: 'add' }>) {
  const guild = deps.guild(guildId);
  if (!guild || !player?.voiceChannelId) return { result: fail('Conecte o bot a um canal de voz primeiro (Entrar).'), detail: null };
  const voiceChannel = guild.channels.cache.get(player.voiceChannelId);
  if (!voiceChannel?.isVoiceBased()) return { result: fail(NOT_CONNECTED), detail: null };

  // Mesma validação do /play: só YouTube, normalizado antes do yt-dlp.
  const parsed = parseInput(action.query);
  if (parsed.kind === 'rejected') return { result: fail(`❌ ${parsed.reason}`), detail: null };

  const outcome = await requestPlay(deps, {
    guild,
    voiceChannel,
    textChannel: player.textChannel,
    input: parsed,
    mode: action.mode,
    requestedBy: PANEL_REQUESTER,
    actor: PANEL_ACTOR,
  });
  if (!outcome.ok) return { result: fail(outcome.message), detail: null };

  const { result, position, tracks, restored } = outcome;
  const title = result.kind === 'single' ? result.track.title : `${result.title} (${tracks.length} faixas)`;
  const where = position === 0 ? 'tocando agora' : `posição #${position}`;
  const note = restored > 0 ? ` 📂 Fila anterior com ${restored} faixa(s) restaurada depois desta.` : '';
  const detail = result.kind === 'single' ? trackLink(result.track, 60) : `${truncate(result.title, 60)} (${tracks.length} faixas)`;
  return { result: { ok: true, message: `➕ ${title} — ${where}.${note}` } as ControlResult, detail };
}

export async function runAction(deps: ActionDeps, guildId: string, action: PanelAction): Promise<ControlResult> {
  const player = deps.players.get(guildId) as PanelPlayer | undefined;

  if (action.type === 'join') {
    const guild = deps.guild(guildId);
    const voice = guild?.channels.cache.get(action.voiceChannelId);
    const text = guild?.channels.cache.get(action.textChannelId);
    if (!guild || !voice?.isVoiceBased()) return fail('Canal de voz não encontrado.');
    if (!text?.isTextBased() || text.isVoiceBased()) return fail('Canal de texto não encontrado.');
    const result = await join(deps.players, PANEL_ACTOR, guild, voice, text);
    const joined = deps.players.get(guildId) as PanelPlayer | undefined;
    const notice = joined ? announcement(action, joined, null) : null;
    if (result.ok && joined && notice && deps.announce) await announce(joined, notice);
    return result;
  }

  if (action.type === 'add') {
    const { result, detail } = await add(deps, guildId, player, action);
    if (result.ok && player && deps.announce) {
      const text = announcement(action, player, detail);
      if (text) await announce(player, text);
    }
    return result;
  }

  if (!player) return fail(NOT_CONNECTED);
  let detail: string | null = null;
  let result: ControlResult;
  switch (action.type) {
    case 'pause':
      result = control.pause(player, PANEL_ACTOR);
      break;
    case 'resume':
      result = control.resume(player, PANEL_ACTOR);
      break;
    case 'skip':
      detail = player.queue.current ? trackLink(player.queue.current, 60) : null;
      result = control.skip(player, PANEL_ACTOR);
      break;
    case 'stop':
      result = control.stop(player, PANEL_ACTOR);
      break;
    case 'leave': {
      // Anuncia antes: depois do destroy o player não manda mais nada.
      const notice = announcement(action, player, null);
      if (deps.announce && notice) await announce(player, notice);
      return control.leave(player, PANEL_ACTOR);
    }
    case 'shuffle':
      result = control.shuffle(player, PANEL_ACTOR);
      break;
    case 'previous':
      result = control.previous(player, PANEL_ACTOR);
      break;
    case 'replay':
      result = await control.replay(player, PANEL_ACTOR);
      break;
    case 'clear':
      result = control.clear(player, PANEL_ACTOR);
      break;
    case 'volume':
      result = control.setVolume(player, PANEL_ACTOR, action.level);
      break;
    case 'loop':
      result = control.setLoop(player, PANEL_ACTOR, action.mode);
      break;
    case 'seek':
      result = await control.seek(player, PANEL_ACTOR, action.positionSec);
      break;
    case 'autoplay':
      result =
        action.enabled === player.autoplay
          ? { ok: true, message: `🤖 Autoplay já está ${action.enabled ? 'ligado' : 'desligado'}.` }
          : control.setAutoplay(player, PANEL_ACTOR, action.enabled);
      break;
    case 'filter':
      result = await control.setFilter(player, PANEL_ACTOR, action.filter);
      break;
    case 'remove':
      detail = itemLabel(player, action.id);
      result = removeById(player, PANEL_ACTOR, action.id);
      break;
    case 'skipto':
      detail = itemLabel(player, action.id);
      result = skipToById(player, PANEL_ACTOR, action.id);
      break;
    case 'move':
      result = moveById(player, PANEL_ACTOR, action.id, action.beforeId);
      break;
  }
  if (result.ok && deps.announce) {
    const text = announcement(action, player, detail);
    if (text) await announce(player, text);
  }
  return result;
}
