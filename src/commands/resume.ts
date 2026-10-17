import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { deny, say } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Continua a faixa pausada')
    .setContexts(InteractionContextType.Guild),

  async execute({ interaction, player }) {
    if (!player.resume()) {
      await deny(interaction, 'Não há nada pausado.');
      return;
    }
    await say(interaction, '▶️ Continuando.');
  },
};

export default command;
