import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import * as control from '../control/playback.js';
import { discordActor, respond } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('replay')
    .setDescription('Recomeça a faixa atual do início')
    .setContexts(InteractionContextType.Guild),

  async execute({ interaction, player }) {
    const beforeSlow = async () => {
      await interaction.deferReply();
    };
    await respond(interaction, await control.replay(player, discordActor(interaction), { beforeSlow }));
  },
};

export default command;
