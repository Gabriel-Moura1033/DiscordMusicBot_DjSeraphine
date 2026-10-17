import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type InteractionEditReplyOptions,
} from 'discord.js';
import { logger } from '../logger.js';
import type { GuildPlayer } from '../player/GuildPlayer.js';
import { formatDuration, trackLink } from '../util/format.js';
import { baseEmbed, LOOP_LABELS } from './embeds.js';
import type { Command } from './types.js';

const PAGE_SIZE = 10;
const COLLECTOR_IDLE_MS = 120_000;

function pageCount(player: GuildPlayer): number {
  return Math.max(1, Math.ceil(player.queue.size / PAGE_SIZE));
}

function render(player: GuildPlayer, page: number, idPrefix: string) {
  const pages = pageCount(player);
  const current = Math.min(Math.max(0, page), pages - 1);
  const upcoming = player.queue.upcoming;
  const nowPlaying = player.queue.current;

  const lines: string[] = [
    nowPlaying
      ? `**Tocando agora:** ${trackLink(nowPlaying, 70)} \`${formatDuration(nowPlaying.durationSec)}\``
      : '*Nada tocando.*',
    '',
  ];
  if (upcoming.length === 0) {
    lines.push('*A fila está vazia.*');
  } else {
    lines.push('**Próximas:**');
    const start = current * PAGE_SIZE;
    upcoming.slice(start, start + PAGE_SIZE).forEach((track, index) => {
      lines.push(
        `\`${start + index + 1}.\` ${trackLink(track, 60)} \`${formatDuration(track.durationSec)}\` — ${track.requestedBy.name}`,
      );
    });
  }

  const total = player.queue.upcomingDuration;
  const totalLabel = `${formatDuration(total.seconds)}${total.unknown > 0 ? '+' : ''}`;
  const embed = baseEmbed()
    .setTitle('📜 Fila')
    .setDescription(lines.join('\n'))
    .setFooter({
      text: `Página ${current + 1}/${pages} · ${upcoming.length} faixa(s) · ${totalLabel} · loop: ${LOOP_LABELS[player.loopMode]} · volume: ${player.volume}%`,
    });

  const components =
    pages > 1
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`${idPrefix}:prev`)
              .setEmoji('◀️')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(current === 0),
            new ButtonBuilder()
              .setCustomId(`${idPrefix}:next`)
              .setEmoji('▶️')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(current >= pages - 1),
          ),
        ]
      : [];

  return { page: current, payload: { embeds: [embed], components } satisfies InteractionEditReplyOptions };
}

const command: Command = {
  guard: 'active-player',
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Mostra a fila de músicas')
    .setContexts(InteractionContextType.Guild),

  async execute({ interaction, player }) {
    const idPrefix = `queue:${interaction.id}`;
    let view = render(player, 0, idPrefix);
    const response = await interaction.reply({ ...view.payload, withResponse: true });
    const message = response.resource?.message;
    if (!message || view.payload.components.length === 0) return;

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      idle: COLLECTOR_IDLE_MS,
      filter: (button) => button.customId.startsWith(idPrefix),
    });

    collector.on('collect', (button) => {
      void (async () => {
        if (button.user.id !== interaction.user.id) {
          await button.reply({ content: 'Só quem usou `/queue` pode trocar de página.', flags: MessageFlags.Ephemeral });
          return;
        }
        const delta = button.customId.endsWith(':next') ? 1 : -1;
        // Recalcula a cada clique: a fila pode ter mudado desde a última página.
        view = render(player, view.page + delta, idPrefix);
        await button.update(view.payload);
      })().catch((error: unknown) => logger.warn({ err: error }, 'queue pagination failed'));
    });

    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch((error: unknown) => {
        logger.debug({ err: error }, 'could not remove queue buttons');
      });
    });
  },
};

export default command;
