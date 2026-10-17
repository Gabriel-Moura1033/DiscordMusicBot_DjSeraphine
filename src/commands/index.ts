import type { ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../logger.js';
import { runGuarded } from './guards.js';
import autoplay from './autoplay.js';
import clear from './clear.js';
import filtro from './filtro.js';
import leave from './leave.js';
import loop from './loop.js';
import nowplaying from './nowplaying.js';
import move from './move.js';
import pause from './pause.js';
import play from './play.js';
import playnow from './playnow.js';
import previous from './previous.js';
import queue from './queue.js';
import remove from './remove.js';
import replay from './replay.js';
import search from './search.js';
import seek from './seek.js';
import { deny, replyUnexpectedError } from './reply.js';
import resume from './resume.js';
import shuffle from './shuffle.js';
import skip from './skip.js';
import skipto from './skipto.js';
import stop from './stop.js';
import type { Command, Services } from './types.js';
import volume from './volume.js';

export const commands: readonly Command[] = [
  play,
  playnow,
  search,
  skip,
  skipto,
  previous,
  replay,
  seek,
  stop,
  pause,
  resume,
  queue,
  nowplaying,
  remove,
  move,
  clear,
  shuffle,
  loop,
  autoplay,
  filtro,
  volume,
  leave,
];

const byName = new Map(commands.map((command) => [command.data.name, command]));

export function commandByName(name: string): Command | undefined {
  return byName.get(name);
}

export async function handleCommand(interaction: ChatInputCommandInteraction, services: Services): Promise<void> {
  const command = byName.get(interaction.commandName);
  if (!command) {
    logger.warn({ name: interaction.commandName }, 'unknown command (registered commands out of date?)');
    await deny(interaction, 'Comando desconhecido. Os comandos podem estar desatualizados; rode o registro de novo.');
    return;
  }
  if (!interaction.inCachedGuild()) {
    await deny(interaction, 'Use os comandos dentro de um servidor.');
    return;
  }

  const log = logger.child({ guildId: interaction.guildId, command: command.data.name, userId: interaction.user.id });
  try {
    const denied = await runGuarded(command, interaction, services);
    if (denied) await deny(interaction, denied);
  } catch (error) {
    log.error({ err: error }, 'command failed');
    await replyUnexpectedError(interaction);
  }
}
