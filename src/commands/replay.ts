import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { trackLink } from '../util/format.js';
import { deny, say } from './reply.js';
import { seekFailureMessage } from './seekReply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('replay')
    .setDescription('Recomeça a faixa atual do início')
    .setContexts(InteractionContextType.Guild),

  async execute({ interaction, player }) {
    const track = player.queue.current;
    if (!track) {
      await deny(interaction, 'Não há nada tocando.');
      return;
    }
    await interaction.deferReply();
    const failure = seekFailureMessage(await player.seek(0));
    if (failure) {
      await interaction.editReply(failure);
      return;
    }
    await say(interaction, `🔄 Recomeçando ${trackLink(track)}.`);
  },
};

export default command;
