import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { playerControlRow } from '../interactions/controls.js';
import { formatDuration, progressBar, truncate } from '../util/format.js';
import { baseEmbed, LOOP_LABELS, thumbnailUrl } from './embeds.js';
import { deny } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'active-player',
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Mostra a faixa atual e o progresso')
    .setContexts(InteractionContextType.Guild),

  async execute({ interaction, services, player }) {
    const now = player.nowPlaying();
    if (!now) {
      await deny(interaction, 'Não há nada tocando.');
      return;
    }

    const { track, elapsedSec, paused } = now;
    const embed = baseEmbed()
      .setAuthor({ name: paused ? '⏸️ Pausado' : '🎶 Tocando agora' })
      .setTitle(truncate(track.title, 256))
      .setURL(track.url)
      .setThumbnail(thumbnailUrl(track))
      .setDescription(
        `${progressBar(elapsedSec, track.durationSec)}\n\`${formatDuration(elapsedSec)} / ${formatDuration(track.durationSec)}\``,
      )
      .addFields(
        { name: 'Pedido por', value: track.requestedBy.name, inline: true },
        { name: 'Volume', value: `${player.volume}%`, inline: true },
        { name: 'Loop', value: LOOP_LABELS[player.loopMode], inline: true },
      );
    if (track.uploader) embed.setFooter({ text: track.uploader });

    const response = await interaction.reply({ embeds: [embed], components: [playerControlRow(player)], withResponse: true });
    const messageId = response.resource?.message?.id;
    if (messageId && interaction.channel) {
      services.panels.attach(player.guildId, track, interaction.channel, messageId, player.loopMode);
    }
  },
};

export default command;
