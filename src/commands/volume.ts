import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { say } from './reply.js';
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
    const level = interaction.options.getInteger('nivel', true);
    player.setVolume(level);
    await say(interaction, `${level === 0 ? '🔇' : '🔊'} Volume: **${level}%**.`);
  },
};

export default command;
