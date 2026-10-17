import type { StringSelectMenuInteraction } from 'discord.js';
import { checkJoin } from '../commands/guards.js';
import { executePlay } from '../commands/playFlow.js';
import { deny } from '../commands/reply.js';
import type { Services } from '../commands/types.js';
import { videoUrl } from '../youtube/url.js';
import { parseSearchId } from './customId.js';

export async function handleSearchSelect(interaction: StringSelectMenuInteraction<'cached'>, services: Services): Promise<void> {
  const parsed = parseSearchId(interaction.customId);
  if (!parsed || parsed.guildId !== interaction.guildId) {
    await deny(interaction, 'Menu inválido.');
    return;
  }

  const key = interaction.customId;
  const owner = services.searches.owner(key);
  if (owner === null) {
    await interaction.update({ components: [] });
    await deny(interaction, '⌛ Essa busca expirou. Use `/search` de novo.');
    return;
  }
  if (owner !== interaction.user.id) {
    await deny(interaction, 'Só quem fez a busca pode escolher. Use `/search` para fazer a sua.');
    return;
  }
  // Antes de consumir a sessão: quem não está no canal pode entrar e escolher de novo.
  const joined = checkJoin(interaction, services);
  if (!joined.ok) {
    await deny(interaction, joined.message);
    return;
  }

  const results = services.searches.take(key);
  const chosen = results?.find((track) => track.id === interaction.values[0]);
  if (!chosen) {
    await interaction.update({ components: [] });
    await deny(interaction, '⌛ Essa busca expirou. Use `/search` de novo.');
    return;
  }

  await interaction.deferUpdate();
  // A mensagem da busca vira a resposta do /play (re-resolve o vídeo para validar disponibilidade).
  await executePlay({
    services,
    guild: interaction.guild,
    member: interaction.member,
    target: joined.value,
    input: { kind: 'video', videoId: chosen.id, url: videoUrl(chosen.id) },
    mode: 'append',
    respond: (options) => interaction.editReply(options),
  });
}
