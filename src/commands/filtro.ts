import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { FILTER_LABELS, FILTER_NAMES, isFilterName } from '../audio/filters.js';
import { deny, say } from './reply.js';
import { seekFailureMessage } from './seekReply.js';
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
    if (filter === player.filter) {
      await deny(interaction, `O filtro já é **${FILTER_LABELS[filter]}**.`);
      return;
    }

    // Reabrir o stream na posição atual leva alguns segundos.
    await interaction.deferReply();
    const result = await player.setFilter(filter);
    const label = `**${FILTER_LABELS[filter]}**`;
    if (result.status === 'idle') {
      await say(interaction, `🎛️ Filtro ${label} salvo; vale a partir da próxima música.`);
      return;
    }
    const failure = seekFailureMessage(result);
    if (failure) {
      // O filtro fica salvo mesmo assim: a próxima faixa já sai com ele.
      await interaction.editReply(`${failure} O filtro ${label} vale a partir da próxima música.`);
      return;
    }
    await say(interaction, `🎛️ Filtro: ${label}.`);
  },
};

export default command;
