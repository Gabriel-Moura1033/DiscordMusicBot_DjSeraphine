import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { trackLink } from '../util/format.js';
import { deny, say } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove uma faixa da fila')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option.setName('posicao').setDescription('Posição na fila (veja /queue)').setRequired(true).setMinValue(1),
    ),

  async execute({ interaction, player }) {
    const position = interaction.options.getInteger('posicao', true);
    const removed = player.queue.remove(position);
    if (!removed) {
      await deny(interaction, `Posição inválida. A fila tem ${player.queue.size} faixa(s).`);
      return;
    }
    await say(interaction, `🗑️ Removi ${trackLink(removed)} da posição #${position}.`);
  },
};

export default command;
