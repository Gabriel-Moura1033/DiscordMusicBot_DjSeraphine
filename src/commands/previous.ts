import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import * as control from '../control/playback.js';
import { discordActor, respond } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('previous')
    .setDescription('Volta para a faixa anterior (a atual volta para o início da fila)')
    .setContexts(InteractionContextType.Guild),

  async execute({ interaction, player }) {
    await respond(interaction, control.previous(player, discordActor(interaction)));
  },
};

export default command;
