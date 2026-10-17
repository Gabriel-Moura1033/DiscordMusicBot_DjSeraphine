import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { deny, say } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Limpa a fila sem parar a faixa atual')
    .setContexts(InteractionContextType.Guild),

  async execute({ interaction, player }) {
    const count = player.queue.size;
    if (count === 0) {
      await deny(interaction, 'A fila já está vazia.');
      return;
    }
    player.queue.clearUpcoming();
    await say(interaction, `🧹 Removi ${count} faixa(s) da fila. A atual continua tocando.`);
  },
};

export default command;
