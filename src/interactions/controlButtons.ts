import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { checkPlayer } from '../commands/guards.js';
import { deny, discordActor } from '../commands/reply.js';
import type { Services } from '../commands/types.js';
import * as control from '../control/playback.js';
import type { Actor } from '../control/types.js';
import type { GuildPlayer } from '../player/GuildPlayer.js';
import { trackLink } from '../util/format.js';
import { controlRow, nextLoopMode, playerControlRow } from './controls.js';
import { parseControlId, type ControlAction } from './customId.js';

/** Executa a ação pela camada de controle; retorna um aviso público (quem pulou/parou) ou `null`. */
function apply(action: ControlAction, player: GuildPlayer, actor: Actor, who: string): string | null {
  switch (action) {
    case 'toggle':
      if (player.isPaused) control.resume(player, actor);
      else control.pause(player, actor);
      return null;
    case 'loop':
      control.setLoop(player, actor, nextLoopMode(player.loopMode));
      return null;
    case 'skip': {
      const current = player.queue.current;
      return control.skip(player, actor).ok && current ? `⏭️ **${who}** pulou ${trackLink(current)}.` : null;
    }
    case 'stop':
      control.stop(player, actor);
      return `⏹️ **${who}** parou a música e limpou a fila.`;
  }
}

export async function handleControlButton(interaction: ButtonInteraction<'cached'>, services: Services): Promise<void> {
  const parsed = parseControlId(interaction.customId);
  if (!parsed || parsed.guildId !== interaction.guildId) {
    await deny(interaction, 'Botão inválido.');
    return;
  }

  const found = checkPlayer(interaction, services, false);
  const player = found.ok ? found.value : null;
  // Botão de uma faixa que já acabou (ou de antes de um restart): só desliga e explica.
  if (!player || !services.panels.isActive(interaction.guildId, interaction.message.id)) {
    const loopMode = player?.loopMode ?? 'off';
    await interaction.update({ components: [controlRow(interaction.guildId, { paused: false, loopMode }, true)] });
    await deny(interaction, player ? 'Esses controles são de uma faixa que já terminou.' : 'Não estou tocando nada agora.');
    return;
  }
  // Mesma regra dos comandos: só quem está no canal de voz do bot controla.
  const allowed = checkPlayer(interaction, services, true);
  if (!allowed.ok) {
    await deny(interaction, allowed.message);
    return;
  }

  const notice = apply(parsed.action, player, discordActor(interaction), interaction.member.displayName);
  // skip/stop encerram a faixa na hora; o painel desta mensagem já não está mais ativo.
  const active = services.panels.isActive(interaction.guildId, interaction.message.id);
  await interaction.update({ components: [playerControlRow(player, !active)] });
  if (notice) {
    await interaction.followUp({ content: notice, flags: MessageFlags.SuppressEmbeds, allowedMentions: { parse: [] } });
  }
}
