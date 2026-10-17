import { REST, Routes } from 'discord.js';
import { commands } from './commands/index.js';
import { config } from './config.js';
import { logger } from './logger.js';

// Registro por guild: atualiza na hora (registro global pode levar até 1 h para propagar).
async function deploy(): Promise<void> {
  const rest = new REST().setToken(config.discordToken);
  const body = commands.map((command) => command.data.toJSON());

  const result = await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
  const count = Array.isArray(result) ? result.length : body.length;
  logger.info({ count, guildId: config.guildId, names: body.map((c) => c.name) }, 'slash commands registered');
}

deploy().catch((error: unknown) => {
  logger.fatal({ err: error }, 'failed to register slash commands');
  process.exitCode = 1;
});
