import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { trackLink } from '../util/format.js';
import { deny, say } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Pula a faixa atual')
    .setContexts(InteractionContextType.Guild),

  async execute({ interaction, player }) {
    const skipped = player.skip();
    if (!skipped) {
      await deny(interaction, 'Não há nada tocando.');
      return;
    }
    await say(interaction, `⏭️ Pulei ${trackLink(skipped)}.`);
  },
};

export default command;
