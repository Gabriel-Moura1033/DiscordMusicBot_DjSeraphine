import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { say } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Sai do canal de voz e descarta a fila')
    .setContexts(InteractionContextType.Guild),

  async execute({ interaction, player }) {
    player.destroy('leave command');
    await say(interaction, '👋 Saí do canal de voz.');
  },
};

export default command;
