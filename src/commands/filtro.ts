import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { FILTER_LABELS, FILTER_NAMES, isFilterName } from '../audio/filters.js';
import * as control from '../control/playback.js';
import { discordActor, respond } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('filtro')
    .setDescription('Aplica um efeito de áudio (fica salvo para o servidor)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName('tipo')
        .setDescription('Efeito')
        .setRequired(true)
        .addChoices(...FILTER_NAMES.map((name) => ({ name: FILTER_LABELS[name], value: name }))),
    ),

  async execute({ interaction, player }) {
    const filter = interaction.options.getString('tipo', true);
    // O Discord só envia valores das choices, mas a checagem mantém o tipo honesto.
    if (!isFilterName(filter)) throw new Error(`invalid filter: ${filter}`);
    // Reabrir o stream na posição atual leva alguns segundos.
    const beforeSlow = async () => {
      await interaction.deferReply();
    };
    await respond(interaction, await control.setFilter(player, discordActor(interaction), filter, { beforeSlow }));
  },
};

export default command;
