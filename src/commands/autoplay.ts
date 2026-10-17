import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { say } from './reply.js';
import type { Command } from './types.js';

const command: Command = {
  guard: 'same-channel',
  data: new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Liga/desliga o autoplay: quando a fila acaba, toca músicas relacionadas à última')
    .setContexts(InteractionContextType.Guild),

  async execute({ interaction, player }) {
    const enabled = !player.autoplay;
    const removed = player.setAutoplay(enabled);
    if (enabled) {
      await say(interaction, '🤖 Autoplay **ligado**: quando a fila acabar, sigo com músicas relacionadas à última que tocou.');
      return;
    }
    const note = removed > 0 ? ` Tirei ${removed} faixa(s) que ele tinha colocado na fila.` : '';
    await say(interaction, `🤖 Autoplay **desligado**.${note}`);
  },
};

export default command;
