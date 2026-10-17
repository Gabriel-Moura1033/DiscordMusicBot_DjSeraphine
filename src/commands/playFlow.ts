import type { Guild, GuildMember, InteractionEditReplyOptions, Message } from 'discord.js';
import { playerControlRow } from '../interactions/controls.js';
import { VoiceConnectError, type GuildPlayer } from '../player/GuildPlayer.js';
import { formatDuration, truncate } from '../util/format.js';
import { YtError } from '../youtube/errors.js';
import type { ResolvableInput } from '../youtube/url.js';
import type { ResolveResult, Track, TrackInfo } from '../youtube/YouTubeService.js';
import { baseEmbed, thumbnailUrl } from './embeds.js';
import { capitalize } from './reply.js';
import type { Services, VoiceTarget } from './types.js';

export type PlayMode = 'append' | 'now';

/** Playlist salva (/playlist carregar): as faixas já estão resolvidas, não passam pelo yt-dlp. */
export interface SavedPlaylistInput {
  readonly kind: 'saved';
  readonly name: string;
  readonly tracks: readonly TrackInfo[];
}

/** /play, /playnow e a escolha do /search: resolve, conecta, enfileira e responde. */
export interface PlayRequest {
  readonly services: Services;
  readonly guild: Guild;
  readonly member: GuildMember;
  readonly target: VoiceTarget;
  readonly input: ResolvableInput | SavedPlaylistInput;
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

async function connect(request: PlayRequest): Promise<GuildPlayer | null> {
  const { services, guild, target } = request;
  try {
    const player = await services.players.getOrCreate(guild, target.voiceChannel, target.textChannel);
    // Outro /play pode ter conectado o bot em outro canal enquanto o yt-dlp resolvia.
    if (player.voiceChannelId !== target.voiceChannel.id) {
      await request.respond({
        content: `Já estou tocando em <#${player.voiceChannelId ?? ''}>. Entre lá para pedir músicas.`,
        embeds: [],
        components: [],
      });
      return null;
    }
    player.textChannel = target.textChannel;
    return player;
  } catch (error) {
    if (error instanceof VoiceConnectError) {
      await request.respond({ content: `❌ ${error.message}`, embeds: [], components: [] });
      return null;
    }
    throw error;
  }
}

export async function executePlay(request: PlayRequest): Promise<void> {
  const { services, member, input, mode } = request;

  let result: ResolveResult;
  try {
    result =
      input.kind === 'saved'
        ? { kind: 'playlist', title: `📁 ${input.name}`, url: '', tracks: input.tracks, skipped: 0, truncated: false }
        : await services.youtube.resolve(input);
  } catch (error) {
    if (error instanceof YtError) {
      await request.respond({ content: `❌ ${capitalize(error.userMessage)}.`, embeds: [], components: [] });
      return;
    }
    throw error;
  }

  const player = await connect(request);
  if (!player) return;

  const requestedBy = { id: member.id, name: member.displayName };
  const withRequester = (info: TrackInfo): Track => ({ ...info, requestedBy });
  const tracks = result.kind === 'single' ? [withRequester(result.track)] : result.tracks.map(withRequester);

  let position: number;
  let header: string | null = null;
  if (mode === 'now') {
    const interrupted = player.playNow(tracks);
    position = 0;
    if (interrupted) header = `⏭️ Pulei "${truncate(interrupted.title, 60)}" — tocando agora`;
  } else {
    position = player.enqueue(tracks);
  }

  const embed =
    result.kind === 'single'
      ? singleEmbed(result.track, position, input.kind === 'search' ? input.query : null, header)
      : playlistEmbed(result, position, services.config.maxPlaylistSize, header);
  const restored = player.consumeRestoredCount();
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
