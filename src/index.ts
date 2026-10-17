import { generateDependencyReport } from '@discordjs/voice';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { handleCommand } from './commands/index.js';
import type { Services } from './commands/types.js';
import { config } from './config.js';
import { startHealthMonitor } from './health.js';
import { logger } from './logger.js';
import { PlayerManager } from './player/PlayerManager.js';
import { runCapture, waitForChildren } from './youtube/process.js';
import { YouTubeService } from './youtube/YouTubeService.js';

const CHILDREN_SHUTDOWN_TIMEOUT_MS = 5_000;

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

  let stopHealthMonitor: (() => void) | null = null;
  client.once(Events.ClientReady, (ready) => {
    logger.info({ user: ready.user.tag, guilds: ready.guilds.cache.size }, 'bot ready');
    stopHealthMonitor = startHealthMonitor(client, config, () => void shutdown('gateway down', 1));
  });
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    void handleCommand(interaction, services);
  });
  client.on(Events.VoiceStateUpdate, (_oldState, newState) => players.onVoiceStateUpdate(newState));
  client.on(Events.Error, (error) => logger.error({ err: error }, 'discord client error'));
  client.on(Events.ShardDisconnect, (event, shardId) => logger.warn({ code: event.code, shardId }, 'gateway disconnected'));

  let shuttingDown = false;
  // Ordem: sair dos canais e matar os filhos (esperando a limpeza do /tmp), depois fechar o gateway.
  const shutdown = async (reason: string, exitCode: number): Promise<void> => {
    if (shuttingDown) {
      logger.warn({ reason }, 'second shutdown request, forcing exit');
      process.exit(exitCode || 1);
    }
    shuttingDown = true;
    logger.info({ reason }, 'shutting down');
    stopHealthMonitor?.();
    players.destroyAll('shutdown');
    const leftover = await waitForChildren(CHILDREN_SHUTDOWN_TIMEOUT_MS);
    if (leftover > 0) logger.warn({ leftover }, 'child processes still alive at shutdown; they will be SIGKILLed');
    try {
      await client.destroy();
    } catch (error) {
      logger.warn({ err: error }, 'error while destroying client');
    }
    logger.info({ exitCode }, 'bye');
    process.exit(exitCode);
  };
  process.on('SIGINT', () => void shutdown('SIGINT', 0));
  process.on('SIGTERM', () => void shutdown('SIGTERM', 0));

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
