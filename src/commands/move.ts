import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import * as control from '../control/playback.js';
import { discordActor, respond } from './reply.js';
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
    await respond(interaction, control.move(player, discordActor(interaction), from, to));
  },
};

export default command;
