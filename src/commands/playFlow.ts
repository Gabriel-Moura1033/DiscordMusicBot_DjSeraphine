import type { Guild, GuildMember, InteractionEditReplyOptions, Message } from 'discord.js';
import { requestPlay, type PlayInput, type PlayMode } from '../control/enqueue.js';
import { playerControlRow } from '../interactions/controls.js';
import { formatDuration, truncate } from '../util/format.js';
import type { ResolveResult, TrackInfo } from '../youtube/YouTubeService.js';
import { baseEmbed, thumbnailUrl } from './embeds.js';
import type { Services, VoiceTarget } from './types.js';

export type { PlayMode, SavedPlaylistInput } from '../control/enqueue.js';

/** /play, /playnow, escolha do /search e /playlist carregar: pede a música e monta a resposta. */
export interface PlayRequest {
  readonly services: Services;
  readonly guild: Guild;
  readonly member: GuildMember;
  readonly target: VoiceTarget;
  readonly input: PlayInput;
  readonly mode: PlayMode;
  /** Interação já reconhecida (deferReply/deferUpdate); edita a resposta. */
  respond(options: InteractionEditReplyOptions): Promise<Message<true>>;
}

function positionLabel(position: number): string {
  return position === 0 ? '▶️ Tocando agora' : `#${position}`;
}

function singleEmbed(track: TrackInfo, position: number, query: string | null, header: string | null) {
  const embed = baseEmbed()
    .setAuthor({ name: header ?? (query !== null ? '🔎 Resultado da busca' : '➕ Adicionado à fila') })
    .setTitle(truncate(track.title, 256))
    .setURL(track.url)
    .setThumbnail(thumbnailUrl(track))
    .addFields(
      { name: 'Duração', value: formatDuration(track.durationSec), inline: true },
      { name: 'Canal', value: truncate(track.uploader ?? 'desconhecido', 100), inline: true },
      { name: 'Posição', value: positionLabel(position), inline: true },
    );
  // Mostra o link cru também, para conferir se a busca acertou.
  if (query !== null) embed.setDescription(`Busca: \`${truncate(query, 100)}\`\n${track.url}`);
  return embed;
}

function playlistEmbed(
  result: Extract<ResolveResult, { kind: 'playlist' }>,
  position: number,
  maxSize: number,
  header: string | null,
) {
  const notes: string[] = [`**${result.tracks.length}** faixas adicionadas.`];
  if (result.skipped > 0) notes.push(`${result.skipped} ignoradas (privadas, removidas, ao vivo ou longas demais).`);
  if (result.truncated) notes.push(`A playlist foi limitada às primeiras ${maxSize} faixas.`);
  return baseEmbed()
    .setAuthor({ name: header ?? '📃 Playlist adicionada' })
    .setTitle(truncate(result.title, 256))
    .setDescription(notes.join('\n'))
    .addFields({ name: 'Posição', value: positionLabel(position), inline: true })
    .setURL(result.url || null);
}

function restoredNote(count: number): string {
  return `📂 Fila anterior com ${count} faixa(s) restaurada (depois desta) — use /clear para descartar.`;
}

export async function executePlay(request: PlayRequest): Promise<void> {
  const { services, member, input, mode } = request;
  const outcome = await requestPlay(services, {
    guild: request.guild,
    voiceChannel: request.target.voiceChannel,
    textChannel: request.target.textChannel,
    input,
    mode,
    requestedBy: { id: member.id, name: member.displayName },
    actor: { source: 'discord', userId: member.id, name: member.displayName },
  });
  if (!outcome.ok) {
    await request.respond({ content: outcome.message, embeds: [], components: [] });
    return;
  }

  const { player, result, tracks, position, interrupted, restored } = outcome;
  const header = interrupted ? `⏭️ Pulei "${truncate(interrupted.title, 60)}" — tocando agora` : null;
  const embed =
    result.kind === 'single'
      ? singleEmbed(result.track, position, input.kind === 'search' ? input.query : null, header)
      : playlistEmbed(result, position, services.config.maxPlaylistSize, header);
  if (restored > 0) embed.setFooter({ text: restoredNote(restored) });
  // Começou a tocar agora: a própria resposta vira o painel de controles (o aviso automático é suprimido).
  const first = tracks[0];
  const startedNow = position === 0 && first !== undefined;
  const message = await request.respond({
    content: '',
    embeds: [embed],
    components: startedNow ? [playerControlRow(player)] : [],
  });
  if (startedNow) services.panels.attach(player.guildId, first, message.channel, message.id, player.loopMode);
}
