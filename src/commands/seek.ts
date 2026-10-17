import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { formatDuration, trackLink } from '../util/format.js';
import { parseTimestamp } from '../util/time.js';
import { deny, say } from './reply.js';
import { seekFailureMessage } from './seekReply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Vai para um ponto da faixa atual')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('tempo').setDescription('Ex.: 1:30 ou 1:02:45').setRequired(true).setMaxLength(12),
    ),

  async execute({ interaction, player }) {
    const raw = interaction.options.getString('tempo', true);
    const position = parseTimestamp(raw);
    if (position === null) {
      await deny(interaction, `Tempo inválido: \`${raw}\`. Use \`mm:ss\` ou \`hh:mm:ss\` (ex.: \`1:30\`).`);
      return;
    }
    const track = player.queue.current;
    if (!track) {
      await deny(interaction, 'Não há nada tocando.');
      return;
    }
    if (track.durationSec !== null && position >= track.durationSec) {
      await deny(interaction, `A faixa tem ${formatDuration(track.durationSec)}; escolha um ponto antes disso.`);
      return;
    }

    // Abrir o stream na nova posição leva alguns segundos.
    await interaction.deferReply();
    const failure = seekFailureMessage(await player.seek(position));
    if (failure) {
      await interaction.editReply(failure);
      return;
    }
    await say(interaction, `⏩ ${trackLink(track)} em \`${formatDuration(position)}\`.`);
  },
};

export default command;
