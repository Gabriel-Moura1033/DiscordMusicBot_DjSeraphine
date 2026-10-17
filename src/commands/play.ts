import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { VoiceConnectError, type GuildPlayer } from '../player/GuildPlayer.js';
import { formatDuration, truncate } from '../util/format.js';
import { YtError } from '../youtube/errors.js';
import { parseInput } from '../youtube/url.js';
import type { ResolveResult, Track, TrackInfo } from '../youtube/YouTubeService.js';
import { baseEmbed, thumbnailUrl } from './embeds.js';
import { capitalize, deny } from './reply.js';
import type { Command, JoinContext } from './types.js';

function positionLabel(position: number): string {
  return position === 0 ? '▶️ Tocando agora' : `#${position}`;
}

function singleEmbed(track: TrackInfo, position: number, query: string | null) {
  const embed = baseEmbed()
    .setAuthor({ name: query !== null ? '🔎 Resultado da busca' : '➕ Adicionado à fila' })
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

function playlistEmbed(result: Extract<ResolveResult, { kind: 'playlist' }>, position: number, maxSize: number) {
  const notes: string[] = [`**${result.tracks.length}** faixas adicionadas.`];
  if (result.skipped > 0) notes.push(`${result.skipped} ignoradas (privadas, removidas, ao vivo ou longas demais).`);
  if (result.truncated) notes.push(`A playlist foi limitada às primeiras ${maxSize} faixas.`);
  return baseEmbed()
    .setAuthor({ name: '📃 Playlist adicionada' })
    .setTitle(truncate(result.title, 256))
    .setURL(result.url)
    .setDescription(notes.join('\n'))
    .addFields({ name: 'Posição', value: positionLabel(position), inline: true });
}

async function connect(ctx: JoinContext): Promise<GuildPlayer | null> {
  const { interaction, services, voiceChannel, textChannel } = ctx;
  try {
    const player = await services.players.getOrCreate(interaction.guild, voiceChannel, textChannel);
    // Outro /play pode ter conectado o bot em outro canal enquanto o yt-dlp resolvia.
    if (player.voiceChannelId !== voiceChannel.id) {
      await interaction.editReply(`Já estou tocando em <#${player.voiceChannelId ?? ''}>. Entre lá para pedir músicas.`);
      return null;
    }
    player.textChannel = textChannel;
    return player;
  } catch (error) {
    if (error instanceof VoiceConnectError) {
      await interaction.editReply(`❌ ${error.message}`);
      return null;
    }
    throw error;
  }
}

const command: Command = {
  guard: 'voice-join',
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Toca um vídeo ou playlist do YouTube, ou busca pelo nome da música')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName('musica')
        .setDescription('Link do YouTube (vídeo, shorts ou playlist) ou nome da música')
        .setRequired(true)
        .setMaxLength(500),
    ),

  async execute(ctx) {
    const { interaction, services } = ctx;
    const parsed = parseInput(interaction.options.getString('musica', true));
    if (parsed.kind === 'rejected') {
      await deny(interaction, `❌ ${parsed.reason}`);
      return;
    }

    await interaction.deferReply();

    let result: ResolveResult;
    try {
      result = await services.youtube.resolve(parsed);
    } catch (error) {
      if (error instanceof YtError) {
        await interaction.editReply(`❌ ${capitalize(error.userMessage)}.`);
        return;
      }
      throw error;
    }

    const player = await connect(ctx);
    if (!player) return;

    const requestedBy = { id: interaction.user.id, name: interaction.member.displayName };
    const withRequester = (info: TrackInfo): Track => ({ ...info, requestedBy });

    if (result.kind === 'single') {
      const position = player.enqueue([withRequester(result.track)]);
      const query = parsed.kind === 'search' ? parsed.query : null;
      await interaction.editReply({ embeds: [singleEmbed(result.track, position, query)] });
      return;
    }

    const position = player.enqueue(result.tracks.map(withRequester));
    await interaction.editReply({ embeds: [playlistEmbed(result, position, services.config.maxPlaylistSize)] });
  },
};

export default command;
