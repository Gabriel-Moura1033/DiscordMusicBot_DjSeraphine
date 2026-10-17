import type { Guild, GuildTextBasedChannel, VoiceBasedChannel, VoiceState } from 'discord.js';
import type { SponsorBlockClient } from '../audio/sponsorblock.js';
import type { Config } from '../config.js';
import type { YouTubeService } from '../youtube/YouTubeService.js';
import { GuildPlayer, type PlayerEvents } from './GuildPlayer.js';
import type { GuildSettings } from './GuildSettings.js';

export class PlayerManager {
  private readonly players = new Map<string, GuildPlayer>();
  /** Conexões em andamento, para dois /play simultâneos não abrirem duas conexões. */
  private readonly connecting = new Map<string, Promise<GuildPlayer>>();
  private readonly settings = new Map<string, GuildSettings>();

  constructor(
    private readonly config: Config,
    private readonly youtube: YouTubeService,
    private readonly events: PlayerEvents,
    private readonly sponsor: SponsorBlockClient | null,
  ) {}

  /** Mesmo objeto para a guild durante todo o processo: o player lê e altera direto. */
  settingsFor(guildId: string): GuildSettings {
    let settings = this.settings.get(guildId);
    if (!settings) {
      settings = { filter: this.config.defaultFilter };
      this.settings.set(guildId, settings);
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
      onDestroyed: (guildId) => {
        if (this.players.get(guildId)?.isDestroyed) this.players.delete(guildId);
      },
    })
      .then((player) => {
        this.players.set(guild.id, player);
        return player;
      })
      .finally(() => this.connecting.delete(guild.id));

    this.connecting.set(guild.id, promise);
    return promise;
  }

  onVoiceStateUpdate(newState: VoiceState): void {
    this.players.get(newState.guild.id)?.checkAlone();
  }

  destroyAll(reason: string): void {
    for (const player of [...this.players.values()]) player.destroy(reason);
  }
}
