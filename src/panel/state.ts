/**
 * Foto do estado para o painel (o mesmo estado que os comandos alteram). O hub reconstrói a foto
 * a cada segundo e em `poke()`, e só publica quando algo relevante mudou; a posição da faixa vai
 * junto com o instante da leitura e o navegador anda sozinho (ADR-048).
 */
import { FILTER_SPEED, type FilterName } from '../audio/filters.js';
import type { LoopMode, QueueEntry } from '../player/Queue.js';
import type { GuildSettings } from '../player/GuildSettings.js';
import type { Track } from '../youtube/YouTubeService.js';

/** Posição periódica mesmo sem mudanças, para corrigir a deriva do relógio do navegador. */
const RESYNC_MS = 5_000;

export interface TrackView {
  readonly qid: string;
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly durationSec: number | null;
  readonly uploader: string | null;
  readonly requestedBy: string;
  readonly autoplay: boolean;
}

export type PlayerStatus = 'playing' | 'paused' | 'idle' | 'disconnected';

export interface GuildView {
  readonly id: string;
  readonly name: string;
  readonly status: PlayerStatus;
  readonly voiceChannel: { readonly id: string; readonly name: string } | null;
  readonly textChannel: { readonly id: string; readonly name: string } | null;
  readonly current: TrackView | null;
  readonly positionSec: number;
  readonly speed: number;
  readonly loop: LoopMode;
  readonly volume: number;
  readonly autoplay: boolean;
  readonly filter: FilterName;
  readonly queue: readonly TrackView[];
  /** Muda em seek/troca de stream (entra na detecção de mudança; a posição em si não). */
  readonly streamGeneration: number;
}

export interface BotView {
  readonly ready: boolean;
  readonly user: string | null;
  readonly startedAt: number;
  readonly ytdlpVersion: string | null;
  readonly children: number;
}

export interface PanelSnapshot {
  readonly at: number;
  readonly bot: BotView;
  readonly guilds: readonly GuildView[];
  readonly features: { readonly seek: true; readonly previous: true; readonly replay: true; readonly autoplay: true; readonly filter: true };
}

/** O que o hub lê do player (o GuildPlayer real ou um falso nos testes). */
export interface StatePlayer {
  readonly queue: { readonly currentId: string | null; readonly current: Track | null; readonly entries: readonly QueueEntry[] };
  readonly voiceChannelId: string | null;
  readonly textChannel: { readonly id: string; readonly name: string };
  readonly isPaused: boolean;
  readonly loopMode: LoopMode;
  readonly volume: number;
  readonly autoplay: boolean;
  readonly filter: FilterName;
  readonly streamGeneration: number;
  nowPlaying(): { readonly elapsedSec: number } | null;
}

export interface SnapshotSource {
  guilds(): readonly { readonly id: string; readonly name: string }[];
  channelName(guildId: string, channelId: string): string | null;
  player(guildId: string): StatePlayer | undefined;
  settings(guildId: string): GuildSettings;
  bot(): BotView;
  now(): number;
}

function trackView(qid: string, track: Track): TrackView {
  return {
    qid,
    id: track.id,
    title: track.title,
    url: track.url,
    durationSec: track.durationSec,
    uploader: track.uploader,
    requestedBy: track.autoplayFrom !== undefined ? `Recomendado pela ${track.requestedBy.name}` : track.requestedBy.name,
    autoplay: track.autoplayFrom !== undefined,
  };
}

function guildView(source: SnapshotSource, guild: { readonly id: string; readonly name: string }): GuildView {
  const player = source.player(guild.id);
  if (!player) {
    const settings = source.settings(guild.id);
    return {
      id: guild.id,
      name: guild.name,
      status: 'disconnected',
      voiceChannel: null,
      textChannel: null,
      current: null,
      positionSec: 0,
      speed: FILTER_SPEED[settings.filter],
      loop: settings.loopMode,
      volume: settings.volume,
      autoplay: settings.autoplay,
      filter: settings.filter,
      queue: [],
      streamGeneration: 0,
    };
  }
  const current = player.queue.current;
  const voiceId = player.voiceChannelId;
  return {
    id: guild.id,
    name: guild.name,
    status: !current ? 'idle' : player.isPaused ? 'paused' : 'playing',
    voiceChannel: voiceId ? { id: voiceId, name: source.channelName(guild.id, voiceId) ?? voiceId } : null,
    textChannel: { id: player.textChannel.id, name: player.textChannel.name },
    current: current && player.queue.currentId ? trackView(player.queue.currentId, current) : null,
    positionSec: Math.round((player.nowPlaying()?.elapsedSec ?? 0) * 10) / 10,
    speed: FILTER_SPEED[player.filter],
    loop: player.loopMode,
    volume: player.volume,
    autoplay: player.autoplay,
    filter: player.filter,
    queue: player.queue.entries.map((entry) => trackView(entry.id, entry.track)),
    streamGeneration: player.streamGeneration,
  };
}

export function buildSnapshot(source: SnapshotSource): PanelSnapshot {
  return {
    at: source.now(),
    bot: source.bot(),
    guilds: source.guilds().map((guild) => guildView(source, guild)),
    features: { seek: true, previous: true, replay: true, autoplay: true, filter: true },
  };
}

/** Chave de mudança: tudo menos o relógio e a posição corrente (que anda sozinha). */
export function changeKey(snapshot: PanelSnapshot): string {
  return JSON.stringify({
    bot: snapshot.bot,
    guilds: snapshot.guilds.map(({ positionSec: _position, ...rest }) => rest),
  });
}

export class StateHub {
  private readonly listeners = new Set<(snapshot: PanelSnapshot) => void>();
  private lastKey = '';
  private lastSentAt = 0;
  private latest: PanelSnapshot;
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly source: SnapshotSource,
    intervalMs = 1_000,
  ) {
    this.latest = buildSnapshot(source);
    this.timer = setInterval(() => this.check(false), intervalMs);
    this.timer.unref();
  }

  current(): PanelSnapshot {
    return this.latest;
  }

  subscribe(listener: (snapshot: PanelSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Força uma leitura agora (depois de uma ação do painel ou de um evento do player). */
  poke(): void {
    this.check(true);
  }

  stop(): void {
    clearInterval(this.timer);
    this.listeners.clear();
  }

  private check(force: boolean): void {
    let snapshot: PanelSnapshot;
    try {
      snapshot = buildSnapshot(this.source);
    } catch {
      // Estado inconsistente por um instante (ex.: player sendo destruído): tenta no próximo ciclo.
      return;
    }
    this.latest = snapshot;
    const key = changeKey(snapshot);
    const stale = snapshot.at - this.lastSentAt >= RESYNC_MS;
    if (!force && key === this.lastKey && !stale) return;
    this.lastKey = key;
    this.lastSentAt = snapshot.at;
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Conexão SSE caída: o servidor remove o assinante ao fechar.
      }
    }
  }
}
