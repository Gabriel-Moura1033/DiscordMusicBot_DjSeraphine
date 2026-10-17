import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { trackLink } from '../util/format.js';
import { deny, say } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('previous')
    .setDescription('Volta para a faixa anterior (a atual volta para o início da fila)')
    .setContexts(InteractionContextType.Guild),

  async execute({ interaction, player }) {
    const result = player.previous();
    if (result === 'busy') {
      await deny(interaction, 'Estou trocando de faixa agora; tente de novo em instantes.');
      return;
    }
    if (!result) {
      await deny(interaction, 'Não há faixas anteriores no histórico.');
      return;
    }
    const restored = player.consumeRestoredCount();
    const note = restored > 0 ? `\n📂 Fila anterior com ${restored} faixa(s) restaurada — use /clear para descartar.` : '';
    await say(interaction, `⏮️ Voltando para ${trackLink(result)}.${note}`);
  },
};

export default command;
