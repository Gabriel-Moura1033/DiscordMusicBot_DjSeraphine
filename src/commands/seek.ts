import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import * as control from '../control/playback.js';
import { discordActor, respond } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Vai para um ponto da faixa atual')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('tempo').setDescription('Ex.: 1:30 ou 1:02:45').setRequired(true).setMaxLength(12),
    ),

  async execute({ interaction, player }) {
    // Abrir o stream na nova posição leva alguns segundos: adia a resposta só depois de validar.
    const raw = interaction.options.getString('tempo', true);
    const beforeSlow = async () => {
      await interaction.deferReply();
    };
    await respond(interaction, await control.seek(player, discordActor(interaction), raw, { beforeSlow }));
  },
};

export default command;
