import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import * as control from '../control/playback.js';
import { discordActor, respond } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Embaralha as próximas faixas da fila')
    .setContexts(InteractionContextType.Guild),

  async execute({ interaction, player }) {
    await respond(interaction, control.shuffle(player, discordActor(interaction)));
  },
};

export default command;
