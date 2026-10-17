import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import * as control from '../control/playback.js';
import { discordActor, respond } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Liga/desliga o autoplay: quando a fila acaba, toca músicas relacionadas à última')
    .setContexts(InteractionContextType.Guild),

  async execute({ interaction, player }) {
    await respond(interaction, control.setAutoplay(player, discordActor(interaction), !player.autoplay));
  },
};

export default command;
