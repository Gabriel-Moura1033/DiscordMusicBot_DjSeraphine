import { generateDependencyReport } from '@discordjs/voice';
import { ActivityType, Client, Events, GatewayIntentBits } from 'discord.js';
import { SEARCH_TTL_MS } from './commands/search.js';
import type { Services } from './commands/types.js';
import { config } from './config.js';
import { startHealthMonitor } from './health.js';
import { ControlPanels } from './interactions/controls.js';
import { routeInteraction } from './interactions/router.js';
import { suggestionFor } from './interactions/searchMenu.js';
import { SearchSessions } from './interactions/searchSessions.js';
import { SuggestionProvider } from './interactions/suggestions.js';
import { logger } from './logger.js';
import type { PlayerEvents } from './player/GuildPlayer.js';
import { PlayerManager } from './player/PlayerManager.js';
import { PresenceTracker } from './presence.js';
import { truncate } from './util/format.js';
import { runCapture, waitForChildren } from './youtube/process.js';
import { YouTubeService, type TrackInfo } from './youtube/YouTubeService.js';

const CHILDREN_SHUTDOWN_TIMEOUT_MS = 5_000;
const AUTOCOMPLETE_RESULTS = 5;
/** A busca do autocomplete continua depois do timeout da resposta, para encher o cache. */
const AUTOCOMPLETE_SEARCH_TIMEOUT_MS = 15_000;
/** Limite do Discord para o nome de uma atividade. */
const ACTIVITY_NAME_LIMIT = 128;

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

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

  const panels = new ControlPanels();
  const presence = config.presenceEnabled
    ? new PresenceTracker({
        apply: (title) => {
          client.user?.setPresence({
            activities: title ? [{ name: truncate(title, ACTIVITY_NAME_LIMIT), type: ActivityType.Listening }] : [],
          });
        },
      })
    : null;
  const events: PlayerEvents = {
    trackStarted: (player, track, announce) => {
      panels.trackStarted(player, track, announce);
      presence?.started(player.guildId, track.title);
    },
    trackFinished: (player) => {
      panels.trackFinished(player);
      presence?.finished(player.guildId);
    },
  };

  const players = new PlayerManager(config, youtube, events);
  const searches = new SearchSessions<TrackInfo>(SEARCH_TTL_MS);
  const suggestions = config.autocompleteEnabled
    ? new SuggestionProvider({
        cacheTtlMs: config.autocompleteCacheTtlMs,
        search: async (query) =>
          (await youtube.search(query, AUTOCOMPLETE_RESULTS, AUTOCOMPLETE_SEARCH_TIMEOUT_MS)).map(suggestionFor),
      })
    : null;
  const services: Services = { config, youtube, players, panels, searches, suggestions };

  let stopHealthMonitor: (() => void) | null = null;
  client.once(Events.ClientReady, (ready) => {
    logger.info({ user: ready.user.tag, guilds: ready.guilds.cache.size }, 'bot ready');
    stopHealthMonitor = startHealthMonitor(client, config, () => void shutdown('gateway down', 1));
  });
  // Sessão nova do gateway (não resume) começa sem presença.
  client.on(Events.ShardReady, () => presence?.refresh());
  client.on(Events.InteractionCreate, (interaction) => void routeInteraction(interaction, services));
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
    presence?.stop();
    searches.clear();
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
