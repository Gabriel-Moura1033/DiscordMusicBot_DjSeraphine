import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { searchId } from '../interactions/customId.js';
import { searchMenuRow, searchResultsEmbed } from '../interactions/searchMenu.js';
import { logger } from '../logger.js';
import { YtError } from '../youtube/errors.js';
import { parseInput } from '../youtube/url.js';
import { capitalize, deny } from './reply.js';
import type { Command } from './types.js';

export const SEARCH_RESULTS = 5;
export const SEARCH_TTL_MS = 60_000;

const command: Command = {
  // Exige estar no canal já na busca: falha cedo em vez de na escolha.
  guard: 'voice-join',
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Busca no YouTube e deixa você escolher entre os 5 primeiros resultados')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('musica').setDescription('Nome da música').setRequired(true).setMaxLength(200),
    ),

  async execute({ interaction, services }) {
    const parsed = parseInput(interaction.options.getString('musica', true));
    if (parsed.kind === 'rejected') {
      await deny(interaction, `❌ ${parsed.reason}`);
      return;
    }
    if (parsed.kind !== 'search') {
      await deny(interaction, 'Para links, use `/play` direto.');
      return;
    }

    await interaction.deferReply();
    let results;
    try {
      results = await services.youtube.search(parsed.query, SEARCH_RESULTS);
    } catch (error) {
      if (error instanceof YtError) {
        await interaction.editReply(`❌ ${capitalize(error.userMessage)}.`);
        return;
      }
      throw error;
    }
    if (results.length === 0) {
      await interaction.editReply(`Nenhum resultado tocável para "${parsed.query}".`);
      return;
    }

    const customId = searchId(interaction.guildId, interaction.user.id, interaction.id);
    const message = await interaction.editReply({
      embeds: [searchResultsEmbed(parsed.query, results, SEARCH_TTL_MS / 1000)],
      components: [searchMenuRow(customId, results)],
      allowedMentions: { parse: [] },
    });
    services.searches.create(customId, interaction.user.id, results, () => {
      // Pelo canal (token do bot), como os botões de controle (ADR-030).
      message.channel.messages
        .edit(message.id, { components: [searchMenuRow(customId, results, true)] })
        .catch((error: unknown) => logger.debug({ err: error, messageId: message.id }, 'could not expire search menu'));
    });
  },
};

export default command;
