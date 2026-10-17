import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { trackLink } from '../util/format.js';
import { deny, say } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move uma faixa para outra posição da fila')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option.setName('de').setDescription('Posição atual (veja /queue)').setRequired(true).setMinValue(1),
    )
    .addIntegerOption((option) =>
      option.setName('para').setDescription('Nova posição (1 = próxima a tocar)').setRequired(true).setMinValue(1),
    ),

  async execute({ interaction, player }) {
    const from = interaction.options.getInteger('de', true);
    const to = interaction.options.getInteger('para', true);
    const moved = player.queue.move(from, to);
    if (!moved) {
      await deny(interaction, `Posição inválida. A fila tem ${player.queue.size} faixa(s).`);
      return;
    }
    await say(interaction, `↕️ Movi ${trackLink(moved)} de #${from} para #${to}.`);
  },
};

export default command;
