import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import * as control from '../control/playback.js';
import { discordActor, respond } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Para a música e limpa a fila (o bot continua no canal)')
    .setContexts(InteractionContextType.Guild),

  async execute({ interaction, player }) {
    await respond(interaction, control.stop(player, discordActor(interaction)));
  },
};

export default command;
