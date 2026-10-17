import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { say } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Para a música e limpa a fila (o bot continua no canal)')
    .setContexts(InteractionContextType.Guild),

  async execute({ interaction, player }) {
    player.stop();
    await say(interaction, '⏹️ Parei a música e limpei a fila.');
  },
};

export default command;
