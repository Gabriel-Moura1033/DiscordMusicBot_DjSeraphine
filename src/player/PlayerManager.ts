import type { Guild, GuildTextBasedChannel, VoiceBasedChannel, VoiceState } from 'discord.js';
import type { SponsorBlockClient } from '../audio/sponsorblock.js';
import type { Config } from '../config.js';
import type { Store } from '../db/repositories.js';
import { logger } from '../logger.js';
import type { Track, YouTubeService } from '../youtube/YouTubeService.js';
import { GuildPlayer, type PlayerEvents } from './GuildPlayer.js';
import type { GuildSettings } from './GuildSettings.js';

/** Intervalo do espelho fila/configurações → SQLite; numa queda perde-se no máximo isso (ADR-042). */
const PERSIST_INTERVAL_MS = 5_000;

export class PlayerManager {
  private readonly players = new Map<string, GuildPlayer>();
  /** Conexões em andamento, para dois /play simultâneos não abrirem duas conexões. */
  private readonly connecting = new Map<string, Promise<GuildPlayer>>();
  private readonly settings = new Map<string, GuildSettings>();
  /** Último JSON gravado por guild: só escreve quando muda. */
  private readonly savedSettings = new Map<string, string>();
  private readonly savedQueues = new Map<string, string>();
  private readonly persistTimer: NodeJS.Timeout;

  constructor(
    private readonly config: Config,
    private readonly youtube: YouTubeService,
    private readonly events: PlayerEvents,
    private readonly sponsor: SponsorBlockClient | null,
    private readonly store: Store,
  ) {
    this.persistTimer = setInterval(() => this.persistAll(), PERSIST_INTERVAL_MS);
    this.persistTimer.unref();
  }

  /** Mesmo objeto para a guild durante todo o processo; carregado do SQLite na primeira vez. */
  settingsFor(guildId: string): GuildSettings {
    let settings = this.settings.get(guildId);
    if (!settings) {
      const defaults: GuildSettings = {
        filter: this.config.defaultFilter,
        loopMode: 'off',
        autoplay: this.config.autoplayDefault,
        volume: this.config.defaultVolume,
      };
      settings = this.guarded('load settings', guildId, () => this.store.settings.load(guildId, defaults)) ?? defaults;
      this.settings.set(guildId, settings);
      this.savedSettings.set(guildId, JSON.stringify(settings));
    }
    return settings;
  }

  /** Descarta players com conexão morta, para o próximo /play reconectar do zero. */
  get(guildId: string): GuildPlayer | undefined {
    const player = this.players.get(guildId);
    if (player?.isStale()) {
      player.destroy('stale voice connection');
      this.players.delete(guildId);
      return undefined;
    }
    return player;
  }

  /** Player da guild sem a checagem de conexão morta (para leitura de estado, sem efeitos colaterais). */
  peek(guildId: string): GuildPlayer | undefined {
    return this.players.get(guildId);
  }

  async getOrCreate(
    guild: Guild,
    voiceChannel: VoiceBasedChannel,
    textChannel: GuildTextBasedChannel,
  ): Promise<GuildPlayer> {
    const existing = this.get(guild.id);
    if (existing) return existing;

    const pending = this.connecting.get(guild.id);
    if (pending) return pending;

    const promise = GuildPlayer.connect(guild, voiceChannel, textChannel, {
      config: this.config,
      youtube: this.youtube,
      events: this.events,
      sponsor: this.sponsor,
      settings: this.settingsFor(guild.id),
      onDestroyed: (player, queue) => this.onDestroyed(player, queue),
    })
      .then((player) => {
        this.players.set(guild.id, player);
        this.hydrate(player);
        return player;
      })
      .finally(() => this.connecting.delete(guild.id));

    this.connecting.set(guild.id, promise);
    return promise;
  }

  onVoiceStateUpdate(newState: VoiceState): void {
    this.players.get(newState.guild.id)?.checkAlone();
  }

  /** Grava o estado de todas as guilds; chamado no intervalo e no shutdown. */
  persistAll(): void {
    for (const player of this.players.values()) this.persistPlayer(player, player.queueSnapshot());
    for (const [guildId, settings] of this.settings) this.persistSettings(guildId, settings);
  }

  destroyAll(reason: string): void {
    clearInterval(this.persistTimer);
    for (const player of [...this.players.values()]) player.destroy(reason);
  }

  /** Fila salva (entregue no primeiro pedido) e histórico do /previous a partir das reproduções. */
  private hydrate(player: GuildPlayer): void {
    const guildId = player.guildId;
    const saved = this.guarded('load queue', guildId, () => this.store.queues.load(guildId)) ?? [];
    player.restore(saved);
    this.savedQueues.set(guildId, queueKey(saved));
    const recent = this.guarded('load history', guildId, () => this.store.plays.recent(guildId, this.config.historySize));
    if (recent) player.seedHistory(recent);
    if (saved.length > 0) logger.info({ guildId, tracks: saved.length }, 'saved queue ready to restore');
  }

  private onDestroyed(player: GuildPlayer, queue: readonly Track[]): void {
    this.persistPlayer(player, queue);
    this.persistSettings(player.guildId, this.settingsFor(player.guildId));
    if (this.players.get(player.guildId) === player) this.players.delete(player.guildId);
  }

  private persistPlayer(player: GuildPlayer, queue: readonly Track[]): void {
    const guildId = player.guildId;
    // Configurações vivas no player (loop, autoplay, volume) voltam para o objeto da guild.
    const settings = this.settingsFor(guildId);
    settings.loopMode = player.loopMode;
    settings.autoplay = player.autoplay;
    settings.volume = player.volume;

    // Fila salva ainda não entregue: o player está vazio de propósito, não sobrescreve.
    if (player.hasPendingRestore && !player.isDestroyed) return;
    const key = queueKey(queue);
    if (this.savedQueues.get(guildId) === key) return;
    const ok = this.guarded('save queue', guildId, () => {
      this.store.queues.save(guildId, queue);
      return true;
    });
    if (ok) this.savedQueues.set(guildId, key);
  }

  private persistSettings(guildId: string, settings: GuildSettings): void {
    const key = JSON.stringify(settings);
    if (this.savedSettings.get(guildId) === key) return;
    const ok = this.guarded('save settings', guildId, () => {
      this.store.settings.save(guildId, settings);
      return true;
    });
    if (ok) this.savedSettings.set(guildId, key);
  }

  /** Erro de banco nunca derruba a reprodução: loga e segue (tenta de novo no próximo ciclo). */
  private guarded<T>(what: string, guildId: string, fn: () => T): T | null {
    try {
      return fn();
    } catch (error) {
      logger.error({ err: error, guildId }, `database: ${what} failed`);
      return null;
    }
  }
}

function queueKey(queue: readonly Track[]): string {
  return JSON.stringify(queue.map((track) => [track.id, track.requestedBy.id, track.autoplayFrom ?? null]));
}
