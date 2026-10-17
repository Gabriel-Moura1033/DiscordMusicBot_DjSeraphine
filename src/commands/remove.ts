import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import * as control from '../control/playback.js';
import { discordActor, respond } from './reply.js';
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
    await respond(interaction, control.remove(player, discordActor(interaction), interaction.options.getInteger('posicao', true)));
  },
};

export default command;
