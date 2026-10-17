import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Message, type MessageEditOptions } from 'discord.js';
import { baseEmbed, requesterLabel, thumbnailUrl } from '../commands/embeds.js';
import { logger } from '../logger.js';
import type { GuildPlayer, PlayerEvents } from '../player/GuildPlayer.js';
import type { LoopMode } from '../player/Queue.js';
import { formatDuration, truncate } from '../util/format.js';
import type { Track } from '../youtube/YouTubeService.js';
import { controlId } from './customId.js';

/** Mensagens com botões por faixa; passando disso, a mais antiga perde os botões. */
const MAX_PANEL_MESSAGES = 5;

export interface ControlState {
  readonly paused: boolean;
  readonly loopMode: LoopMode;
}

const LOOP_CYCLE: Record<LoopMode, LoopMode> = { off: 'track', track: 'queue', queue: 'off' };
const LOOP_BUTTON: Record<LoopMode, { readonly emoji: string; readonly label: string }> = {
  off: { emoji: '🔁', label: 'Loop: off' },
  track: { emoji: '🔂', label: 'Loop: faixa' },
  queue: { emoji: '🔁', label: 'Loop: fila' },
};

export function nextLoopMode(mode: LoopMode): LoopMode {
  return LOOP_CYCLE[mode];
}

export function controlRow(guildId: string, state: ControlState, disabled = false): ActionRowBuilder<ButtonBuilder> {
  const loop = LOOP_BUTTON[state.loopMode];
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(controlId('toggle', guildId))
      .setEmoji(state.paused ? '▶️' : '⏸️')
      .setLabel(state.paused ? 'Continuar' : 'Pausar')
      .setStyle(state.paused ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(controlId('skip', guildId))
      .setEmoji('⏭️')
      .setLabel('Pular')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(controlId('loop', guildId))
      .setEmoji(loop.emoji)
      .setLabel(loop.label)
      .setStyle(state.loopMode === 'off' ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(controlId('stop', guildId))
      .setEmoji('⏹️')
      .setLabel('Parar')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

export function playerControlRow(player: GuildPlayer, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return controlRow(player.guildId, { paused: player.isPaused, loopMode: player.loopMode }, disabled);
}

/** O mínimo de um canal que o painel usa; permite testar sem o discord.js de verdade. */
export interface EditableChannel {
  readonly id: string;
  readonly messages: { edit(messageId: string, options: MessageEditOptions): Promise<unknown> };
}

interface PanelMessage {
  readonly channel: EditableChannel;
  readonly messageId: string;
}

interface Panel {
  readonly track: Track;
  readonly messages: PanelMessage[];
}

/**
 * Rastreia as mensagens com botões da faixa atual de cada guild e desabilita os botões quando a
 * faixa acaba. A edição é feita pelo canal (token do bot), não pelo token da interação, que
 * expira em 15 min (ADR-030).
 */
export class ControlPanels implements PlayerEvents {
  private readonly panels = new Map<string, Panel>();

  trackStarted(player: GuildPlayer, track: Track, announce: boolean): void {
    const panel: Panel = { track, messages: [] };
    this.panels.set(player.guildId, panel);
    if (announce) void this.announce(player, track, panel);
  }

  trackFinished(player: GuildPlayer): void {
    const panel = this.panels.get(player.guildId);
    if (!panel) return;
    this.panels.delete(player.guildId);
    for (const message of panel.messages) this.disable(player.guildId, message, player.loopMode);
  }

  /** Registra uma mensagem com botões; se a faixa já mudou, só desabilita. */
  attach(guildId: string, track: Track, channel: EditableChannel, messageId: string, loopMode: LoopMode): void {
    const panel = this.panels.get(guildId);
    const message = { channel, messageId };
    if (!panel || panel.track !== track) {
      this.disable(guildId, message, loopMode);
      return;
    }
    this.add(guildId, panel, message, loopMode);
  }

  /** Mensagem ainda é um painel válido (da faixa que está tocando). */
  isActive(guildId: string, messageId: string): boolean {
    return this.panels.get(guildId)?.messages.some((message) => message.messageId === messageId) ?? false;
  }

  private add(guildId: string, panel: Panel, message: PanelMessage, loopMode: LoopMode): void {
    panel.messages.push(message);
    while (panel.messages.length > MAX_PANEL_MESSAGES) {
      const oldest = panel.messages.shift();
      if (oldest) this.disable(guildId, oldest, loopMode);
    }
  }

  private async announce(player: GuildPlayer, track: Track, panel: Panel): Promise<void> {
    const embed = baseEmbed()
      .setAuthor({ name: '🎶 Tocando agora' })
      .setTitle(truncate(track.title, 256))
      .setURL(track.url)
      .setThumbnail(thumbnailUrl(track))
      .setDescription(`\`${formatDuration(track.durationSec)}\` · pedido por **${requesterLabel(track)}**`);
    let message: Message<true>;
    try {
      message = await player.textChannel.send({
        embeds: [embed],
        components: [playerControlRow(player)],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      logger.warn({ err: error, guildId: player.guildId }, 'failed to send now playing message');
      return;
    }
    const ref = { channel: message.channel, messageId: message.id };
    // A faixa pode ter acabado enquanto a mensagem era enviada.
    if (this.panels.get(player.guildId) !== panel) this.disable(player.guildId, ref, player.loopMode);
    else this.add(player.guildId, panel, ref, player.loopMode);
  }

  private disable(guildId: string, message: PanelMessage, loopMode: LoopMode): void {
    message.channel.messages
      .edit(message.messageId, { components: [controlRow(guildId, { paused: false, loopMode }, true)] })
      .catch((error: unknown) => {
        // Mensagem apagada ou sem permissão no canal: nada a fazer.
        logger.debug({ err: error, guildId, messageId: message.messageId }, 'could not disable control buttons');
      });
  }
}
