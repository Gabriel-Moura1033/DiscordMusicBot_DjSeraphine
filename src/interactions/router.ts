import type { Interaction } from 'discord.js';
import { commandByName, handleCommand } from '../commands/index.js';
import { deny, replyUnexpectedError } from '../commands/reply.js';
import type { Services } from '../commands/types.js';
import { logger } from '../logger.js';
import { handleControlButton } from './controlButtons.js';
import { handleSearchSelect } from './searchSelect.js';

/**
 * Handler global de `interactionCreate` (ADR-030): componentes são roteados pelo prefixo do
 * `customId`, sem collectors por mensagem. Prefixos desconhecidos (ex.: `queue:`, ainda tratado
 * pelo collector do /queue) são ignorados aqui.
 */
export async function routeInteraction(interaction: Interaction, services: Services): Promise<void> {
  if (interaction.isChatInputCommand()) {
    await handleCommand(interaction, services);
    return;
  }

  if (interaction.isAutocomplete()) {
    const command = commandByName(interaction.commandName);
    if (!command?.autocomplete || !interaction.inCachedGuild()) {
      await interaction.respond([]).catch(() => undefined);
      return;
    }
    try {
      await command.autocomplete(interaction, services);
    } catch (error) {
      logger.warn({ err: error, command: interaction.commandName }, 'autocomplete failed');
    }
    return;
  }

  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
  const prefix = interaction.customId.split(':', 1)[0];
  if (prefix !== 'ctl' && prefix !== 'srch') return;

  if (!interaction.inCachedGuild()) {
    await deny(interaction, 'Use os controles dentro de um servidor.');
    return;
  }
  const log = logger.child({ guildId: interaction.guildId, customId: interaction.customId, userId: interaction.user.id });
  try {
    if (prefix === 'ctl' && interaction.isButton()) await handleControlButton(interaction, services);
    else if (prefix === 'srch' && interaction.isStringSelectMenu()) await handleSearchSelect(interaction, services);
  } catch (error) {
    log.error({ err: error }, 'component interaction failed');
    await replyUnexpectedError(interaction);
  }
}
