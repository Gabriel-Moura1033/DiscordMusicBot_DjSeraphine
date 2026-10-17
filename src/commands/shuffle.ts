import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { deny, say } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Embaralha as próximas faixas da fila')
    .setContexts(InteractionContextType.Guild),

  async execute({ interaction, player }) {
    if (player.queue.size < 2) {
      await deny(interaction, 'Precisa de pelo menos 2 faixas na fila para embaralhar.');
      return;
    }
    player.queue.shuffle();
    await say(interaction, `🔀 Embaralhei ${player.queue.size} faixas.`);
  },
};

export default command;
