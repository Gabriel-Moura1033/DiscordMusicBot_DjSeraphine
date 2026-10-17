import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import * as control from '../control/playback.js';
import { discordActor, respond } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Ajusta o volume')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option.setName('nivel').setDescription('0 a 100').setRequired(true).setMinValue(0).setMaxValue(100),
    ),

  async execute({ interaction, player }) {
    await respond(interaction, control.setVolume(player, discordActor(interaction), interaction.options.getInteger('nivel', true)));
  },
};

export default command;
