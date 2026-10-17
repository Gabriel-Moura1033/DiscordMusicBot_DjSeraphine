import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { deny, say } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pausa a faixa atual')
    .setContexts(InteractionContextType.Guild),

  async execute({ interaction, player }) {
    if (!player.pause()) {
      await deny(interaction, 'Não há nada tocando (ou já está pausado).');
      return;
    }
    await say(interaction, '⏸️ Pausado. Use `/resume` para continuar.');
  },
};

export default command;
