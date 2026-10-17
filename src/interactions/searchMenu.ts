import { ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { baseEmbed } from '../commands/embeds.js';
import { formatDuration, trackLink, truncate } from '../util/format.js';
import type { TrackInfo } from '../youtube/YouTubeService.js';
import type { Suggestion } from './suggestions.js';

/** Limite do Discord para nome de opção de autocomplete e label/descrição de select. */
const DISCORD_TEXT_LIMIT = 100;

/** "Título — Canal (3:45)", cortando o título para o resto caber em 100 caracteres. */
export function suggestionFor(track: TrackInfo): Suggestion {
  const suffix = `${track.uploader ? ` — ${track.uploader}` : ''} (${formatDuration(track.durationSec)})`;
  const room = DISCORD_TEXT_LIMIT - Math.min(suffix.length, 60);
  return { name: truncate(`${truncate(track.title, room)}${suffix}`, DISCORD_TEXT_LIMIT), value: track.url };
}

export function searchMenuRow(
  customId: string,
  results: readonly TrackInfo[],
  disabled = false,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(disabled ? '⌛ Busca expirada — use /search de novo' : 'Escolha uma música')
    .setDisabled(disabled)
    .addOptions(
      results.map((track, index) => ({
        label: truncate(`${index + 1}. ${track.title}`, DISCORD_TEXT_LIMIT),
        description: truncate(`${track.uploader ?? 'canal desconhecido'} · ${formatDuration(track.durationSec)}`, DISCORD_TEXT_LIMIT),
        value: track.id,
      })),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function searchResultsEmbed(query: string, results: readonly TrackInfo[], ttlSec: number) {
  const lines = results.map(
    (track, index) =>
      `\`${index + 1}.\` ${trackLink(track, 70)} \`${formatDuration(track.durationSec)}\`${track.uploader ? ` — ${truncate(track.uploader, 40)}` : ''}`,
  );
  return baseEmbed()
    .setAuthor({ name: `🔎 Resultados para "${truncate(query, 80)}"` })
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Escolha no menu abaixo em até ${ttlSec} s.` });
}
