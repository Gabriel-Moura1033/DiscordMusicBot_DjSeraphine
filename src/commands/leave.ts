import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import * as control from '../control/playback.js';
import { discordActor, respond } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Sai do canal de voz e descarta a fila')
    .setContexts(InteractionContextType.Guild),

  async execute({ interaction, player }) {
    await respond(interaction, control.leave(player, discordActor(interaction)));
  },
};

export default command;
