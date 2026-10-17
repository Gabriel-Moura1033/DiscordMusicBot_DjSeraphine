import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { parseInput } from '../youtube/url.js';
import { executePlay, type PlayMode } from './playFlow.js';
import { deny } from './reply.js';
import type { Command } from './types.js';

/** `/play` e `/playnow` compartilham validação, busca e conexão; só muda onde as faixas entram. */
export function createPlayCommand(name: string, description: string, mode: PlayMode): Command {
  return {
    guard: 'voice-join',
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)
      .setContexts(InteractionContextType.Guild)
      .addStringOption((option) =>
        option
          .setName('musica')
          .setDescription('Link do YouTube (vídeo, shorts ou playlist) ou nome da música')
          .setRequired(true)
          .setMaxLength(500)
          // Lido no registro: mudar AUTOCOMPLETE_ENABLED exige rodar o deploy de novo.
          .setAutocomplete(config.autocompleteEnabled),
      ),

    async autocomplete(interaction, services) {
      const focused = interaction.options.getFocused();
      const suggestions = services.suggestions ? await services.suggestions.suggest(interaction.user.id, focused) : [];
      try {
        await interaction.respond(suggestions.map(({ name: choice, value }) => ({ name: choice, value })));
      } catch (error) {
        // Requisição superada ou expirada (3 s): o Discord já não espera resposta.
        logger.debug({ err: error }, 'autocomplete response failed');
      }
    },

    async execute(ctx) {
      const { interaction, services } = ctx;
      const parsed = parseInput(interaction.options.getString('musica', true));
      if (parsed.kind === 'rejected') {
        await deny(interaction, `❌ ${parsed.reason}`);
        return;
      }

      await interaction.deferReply();
      await executePlay({
        services,
        guild: interaction.guild,
        member: interaction.member,
        target: ctx,
        input: parsed,
        mode,
        respond: (options) => interaction.editReply(options),
      });
    },
  };
}

export default createPlayCommand(
  'play',
  'Toca um vídeo ou playlist do YouTube, ou busca pelo nome da música',
  'append',
);
