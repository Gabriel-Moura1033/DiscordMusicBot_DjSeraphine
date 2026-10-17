import { generateDependencyReport } from '@discordjs/voice';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { handleCommand } from './commands/index.js';
import type { Services } from './commands/types.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { PlayerManager } from './player/PlayerManager.js';
import { runCapture } from './youtube/process.js';
import { YouTubeService } from './youtube/YouTubeService.js';

async function checkBinaries(youtube: YouTubeService): Promise<void> {
  const ytdlp = await youtube.version();
  if (!ytdlp) throw new Error(`yt-dlp não encontrado ou não executável (YTDLP_PATH=${config.ytdlpPath})`);

  const ffmpeg = await runCapture(config.ffmpegPath, ['-version'], { timeoutMs: 15_000, maxStdoutBytes: 64 * 1024 });
  if (ffmpeg.code !== 0) throw new Error(`ffmpeg não encontrado ou não executável (FFMPEG_PATH=${config.ffmpegPath})`);

  logger.info({ ytdlp, ffmpeg: ffmpeg.stdout.split('\n')[0] }, 'external binaries ok');
}

async function main(): Promise<void> {
  const youtube = new YouTubeService(config);
  await checkBinaries(youtube);
  logger.debug(`\n${generateDependencyReport()}`);

  const players = new PlayerManager(config, youtube);
  const services: Services = { config, youtube, players };

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

  client.once(Events.ClientReady, (ready) => {
    logger.info({ user: ready.user.tag, guilds: ready.guilds.cache.size }, 'bot ready');
  });
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    void handleCommand(interaction, services);
  });
  client.on(Events.VoiceStateUpdate, (_oldState, newState) => players.onVoiceStateUpdate(newState));
  client.on(Events.Error, (error) => logger.error({ err: error }, 'discord client error'));
  client.on(Events.ShardDisconnect, (event, shardId) => logger.warn({ code: event.code, shardId }, 'gateway disconnected'));

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    players.destroyAll('shutdown');
    void client
      .destroy()
      .catch((error: unknown) => logger.warn({ err: error }, 'error while destroying client'))
      .finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await client.login(config.discordToken);
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
});
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception');
  process.exit(1);
});

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'failed to start');
  process.exit(1);
});
