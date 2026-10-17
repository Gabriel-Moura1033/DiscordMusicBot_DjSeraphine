import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { trackLink } from '../util/format.js';
import { deny, say } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('skipto')
    .setDescription('Pula direto para uma posição da fila')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option.setName('posicao').setDescription('Posição na fila (veja /queue)').setRequired(true).setMinValue(1),
    ),

  async execute({ interaction, player }) {
    const position = interaction.options.getInteger('posicao', true);
    const result = player.skipTo(position);
    if (result === 'busy') {
      await deny(interaction, 'Estou trocando de faixa agora; tente de novo em instantes.');
      return;
    }
    if (!result) {
      const reason = player.queue.current ? `A fila tem ${player.queue.size} faixa(s).` : 'Não há nada tocando.';
      await deny(interaction, `Posição inválida. ${reason}`);
      return;
    }
    const where = player.loopMode === 'queue' ? 'foram para o fim da fila' : 'saíram da fila';
    const note = result.skipped > 0 ? ` (${result.skipped} faixa(s) puladas ${where})` : '';
    await say(interaction, `⏩ Pulando para ${trackLink(result.track)}${note}.`);
  },
};

export default command;
