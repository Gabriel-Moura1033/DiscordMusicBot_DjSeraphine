import { MessageFlags, type RepliableInteraction } from 'discord.js';
import { logger } from '../logger.js';

/** Resposta pública, sem preview de links e sem mencionar ninguém. */
export async function say(interaction: RepliableInteraction, content: string): Promise<void> {
  const options = { content, allowedMentions: { parse: [] } } as const;
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ ...options, flags: MessageFlags.SuppressEmbeds });
    return;
  }
  await interaction.reply({ ...options, flags: MessageFlags.SuppressEmbeds });
}

/** Resposta efêmera (só quem usou o comando vê). */
export async function deny(interaction: RepliableInteraction, content: string): Promise<void> {
  const options = { content, allowedMentions: { parse: [] } } as const;
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ ...options, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ ...options, flags: MessageFlags.Ephemeral });
}

export async function replyUnexpectedError(interaction: RepliableInteraction): Promise<void> {
  const content = '❌ Ocorreu um erro inesperado. Tente de novo em instantes.';
  try {
    if (interaction.deferred && !interaction.replied) await interaction.editReply({ content });
    else await deny(interaction, content);
  } catch (error) {
    // A interação pode ter expirado (15 min) ou o canal sumido.
    logger.debug({ err: error }, 'could not report error to user');
  }
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
