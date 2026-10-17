import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import type { LoopMode } from '../player/Queue.js';
import * as control from '../control/playback.js';
import { discordActor, respond } from './reply.js';
import type { Command } from './types.js';

function isLoopMode(value: string): value is LoopMode {
  return value === 'off' || value === 'track' || value === 'queue';
}

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Define o modo de repetição')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName('modo')
        .setDescription('O que repetir')
        .setRequired(true)
        .addChoices(
          { name: 'desligado', value: 'off' },
          { name: 'faixa atual', value: 'track' },
          { name: 'fila inteira', value: 'queue' },
        ),
    ),

  async execute({ interaction, player }) {
    const mode = interaction.options.getString('modo', true);
    // O Discord só envia valores das choices, mas a checagem mantém o tipo honesto.
    if (!isLoopMode(mode)) throw new Error(`invalid loop mode: ${mode}`);
    await respond(interaction, control.setLoop(player, discordActor(interaction), mode));
  },
};

export default command;
