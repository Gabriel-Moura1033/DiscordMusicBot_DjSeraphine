import {
  AudioPlayerStatus,
  createAudioPlayer,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  type AudioPlayer,
  type VoiceConnection,
} from '@discordjs/voice';
import { MessageFlags, type Guild, type GuildTextBasedChannel, type VoiceBasedChannel } from 'discord.js';
import type { Logger } from 'pino';
import type { Config } from '../config.js';
import { logger } from '../logger.js';
import { trackLink } from '../util/format.js';
import type { YtError } from '../youtube/errors.js';
import type { ActiveStream, Track, YouTubeService } from '../youtube/YouTubeService.js';
import { Queue, type AdvanceOptions, type LoopMode } from './Queue.js';

const CONNECT_TIMEOUT_MS = 20_000;
const RECONNECT_TIMEOUT_MS = 5_000;
/** Fora de Ready por mais que isso: tenta rejoin(); se falhar de novo, encerra. */
const READY_WATCHDOG_MS = 20_000;
const MAX_REJOINS = 1;
/** Quanto esperar o yt-dlp sair depois que o áudio acabou, para saber se foi falha. */
const FAILURE_GRACE_MS = 3_000;
/** Abaixo disso, uma falha é "não consegui tocar"; acima, "foi interrompida". */
const EARLY_FAILURE_MS = 2_000;
/** Novas tentativas silenciosas para falhas transitórias antes de o áudio começar (ex.: 403 do googlevideo). */
const MAX_STREAM_RETRIES = 2;
/** Folga entre a duração do vídeo e o áudio tocado antes de considerar que a faixa terminou cedo. */
const EARLY_END_TOLERANCE_SEC = 10;

/**
 * Ganchos para a camada de interface (painel de controles, presença). `trackFinished` sempre vem
 * antes do `trackStarted` seguinte, e também no destroy.
 */
export interface PlayerEvents {
  trackStarted?(player: GuildPlayer, track: Track, announce: boolean): void;
  trackFinished?(player: GuildPlayer, track: Track): void;
}

export interface GuildPlayerDeps {
  readonly config: Config;
  readonly youtube: YouTubeService;
  readonly events: PlayerEvents;
  readonly onDestroyed: (guildId: string) => void;
}

export interface NowPlaying {
  readonly track: Track;
  readonly elapsedSec: number;
  readonly paused: boolean;
}

export class VoiceConnectError extends Error {
  override readonly name = 'VoiceConnectError';
}

export class GuildPlayer {
  readonly queue = new Queue();
  private readonly audioPlayer: AudioPlayer;
  private readonly log: Logger;
  private active: ActiveStream | null = null;
  /** Definido por /skip, /stop e /playnow antes de parar o player; consumido no próximo Idle. */
  private pendingAdvance: AdvanceOptions | null = null;
  /** /playnow já mostra a faixa na resposta; evita o aviso duplicado de "tocando agora". */
  private quietNextStart = false;
  private volumePercent: number;
  private idleTimer: NodeJS.Timeout | null = null;
  private aloneTimer: NodeJS.Timeout | null = null;
  private destroyed = false;
  private readyWatchdog: NodeJS.Timeout | null = null;
  private rejoins = 0;
  /** Momento em que a conexão saiu de Ready (`null` = está Ready). */
  private notReadySince: number | null = null;
  private retries = 0;
  /** Faixa para a qual `trackStarted` foi emitido e `trackFinished` ainda não. */
  private startedTrack: Track | null = null;

  private constructor(
    private readonly guild: Guild,
    private readonly connection: VoiceConnection,
    /** Onde os avisos (tocando agora, erros, saída) são enviados; atualizado a cada /play. */
    public textChannel: GuildTextBasedChannel,
    private readonly deps: GuildPlayerDeps,
  ) {
    this.log = logger.child({ guildId: guild.id });
    this.volumePercent = deps.config.defaultVolume;
    this.audioPlayer = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    this.connection.subscribe(this.audioPlayer);

    this.audioPlayer.on('stateChange', (oldState, newState) => {
      if (newState.status === AudioPlayerStatus.Idle && oldState.status !== AudioPlayerStatus.Idle) {
        void this.onTrackEnd();
      }
    });
    this.audioPlayer.on('error', (error) => {
      // O player vai para Idle logo em seguida; onTrackEnd decide o que avisar.
      this.log.warn({ err: error }, 'audio player error');
    });

    this.connection.on('stateChange', (oldState, newState) => {
      if (oldState.status === newState.status) return;
      this.log.info({ from: oldState.status, to: newState.status }, 'voice connection state');
      this.onConnectionState(newState.status);
    });
    this.connection.on(VoiceConnectionStatus.Disconnected, () => void this.onDisconnected());
    this.connection.on(VoiceConnectionStatus.Destroyed, () => this.destroy('connection destroyed'));
    this.connection.on('error', (error) => this.log.warn({ err: error }, 'voice connection error'));
  }

  static async connect(
    guild: Guild,
    voiceChannel: VoiceBasedChannel,
    textChannel: GuildTextBasedChannel,
    deps: GuildPlayerDeps,
  ): Promise<GuildPlayer> {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, CONNECT_TIMEOUT_MS);
    } catch (error) {
      connection.destroy();
      logger.warn({ err: error, guildId: guild.id }, 'voice connection did not become ready');
      throw new VoiceConnectError('Não consegui conectar ao canal de voz (tempo esgotado).');
    }
    const player = new GuildPlayer(guild, connection, textChannel, deps);
    player.log.info({ channelId: voiceChannel.id }, 'joined voice channel');
    player.armIdleTimer();
    player.checkAlone();
    return player;
  }

  get guildId(): string {
    return this.guild.id;
  }

  get voiceChannelId(): string | null {
    return this.connection.joinConfig.channelId;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * Conexão que não serve mais: destruída, presa fora de Ready além do watchdog, ou
   * "Ready" localmente enquanto o Discord diz que o bot não está no canal.
   */
  isStale(): boolean {
    if (this.destroyed) return true;
    const status = this.connection.state.status;
    if (status === VoiceConnectionStatus.Destroyed) return true;
    if (status !== VoiceConnectionStatus.Ready) {
      return this.notReadySince !== null && Date.now() - this.notReadySince > READY_WATCHDOG_MS * (MAX_REJOINS + 1);
    }
    const actualChannelId = this.guild.members.me?.voice.channelId ?? null;
    return actualChannelId !== this.voiceChannelId;
  }

  get volume(): number {
    return this.volumePercent;
  }

  get loopMode(): LoopMode {
    return this.queue.loopMode;
  }

  get isPaused(): boolean {
    const status = this.audioPlayer.state.status;
    return status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused;
  }

  /** Retorna a posição na fila do primeiro item adicionado (0 = começou a tocar agora). */
  enqueue(tracks: readonly Track[]): number {
    if (this.destroyed || tracks.length === 0) return -1;
    const startNow = this.queue.current === null;
    const position = startNow ? 0 : this.queue.size + 1;
    this.queue.add(tracks);
    // A resposta do /play já mostra a faixa; não duplica o aviso de "tocando agora".
    if (startNow) this.playNext({ skip: false, drop: false }, false);
    return position;
  }

  /**
   * Coloca `tracks` no início da fila e pula a faixa atual; o resto da fila é preservado.
   * Retorna a faixa interrompida (`null` se nada tocava).
   */
  playNow(tracks: readonly Track[]): Track | null {
    if (this.destroyed || tracks.length === 0) return null;
    const current = this.queue.current;
    if (!current) {
      this.enqueue(tracks);
      return null;
    }
    this.queue.addFront(tracks);
    this.quietNextStart = true;
    this.stopCurrent({ skip: true, drop: false });
    return current;
  }

  nowPlaying(): NowPlaying | null {
    const track = this.queue.current;
    if (!track) return null;
    return {
      track,
      elapsedSec: (this.active?.resource.playbackDuration ?? 0) / 1000,
      paused: this.audioPlayer.state.status === AudioPlayerStatus.Paused,
    };
  }

  skip(): Track | null {
    const current = this.queue.current;
    if (!current) return null;
    this.stopCurrent({ skip: true, drop: false });
    return current;
  }

  stop(): void {
    this.queue.clearUpcoming();
    this.queue.loopMode = 'off';
    if (this.queue.current) this.stopCurrent({ skip: true, drop: true });
  }

  pause(): boolean {
    return this.audioPlayer.pause();
  }

  resume(): boolean {
    return this.audioPlayer.unpause();
  }

  setVolume(percent: number): void {
    this.volumePercent = percent;
    this.active?.resource.volume?.setVolumeLogarithmic(percent / 100);
  }

  setLoop(mode: LoopMode): void {
    this.queue.loopMode = mode;
  }

  /** Chamado a cada voiceStateUpdate da guild. */
  checkAlone(): void {
    if (this.destroyed) return;
    const channelId = this.voiceChannelId;
    const channel = channelId ? this.guild.channels.cache.get(channelId) : undefined;
    if (!channel?.isVoiceBased()) return;

    const humans = channel.members.filter((member) => !member.user.bot).size;
    if (humans > 0) {
      this.clearTimer('alone');
      return;
    }
    if (this.aloneTimer) return;
    this.log.debug('alone in voice channel, arming timer');
    this.aloneTimer = setTimeout(() => {
      void this.notify('👋 Fiquei sozinho no canal de voz, então saí.');
      this.destroy('alone timeout');
    }, this.deps.config.idleTimeoutMs);
  }

  destroy(reason: string): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearTimer('idle');
    this.clearTimer('alone');
    if (this.readyWatchdog) clearTimeout(this.readyWatchdog);
    this.readyWatchdog = null;
    this.finishTrack();
    this.queue.reset();
    this.active?.kill();
    this.active = null;
    this.audioPlayer.stop(true);
    if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
    this.deps.onDestroyed(this.guild.id);
    this.log.info({ reason }, 'guild player destroyed');
  }

  private stopCurrent(advance: AdvanceOptions): void {
    // Já em Idle = onTrackEnd está em andamento; um pendingAdvance agora vazaria para a próxima faixa.
    if (this.audioPlayer.state.status === AudioPlayerStatus.Idle) return;
    this.pendingAdvance = advance;
    // Matar antes de parar garante que onTrackEnd não interprete o fim como falha.
    this.active?.kill();
    this.audioPlayer.stop(true);
  }

  private playNext(advance: AdvanceOptions, announce = true): void {
    if (this.destroyed) return;
    this.finishTrack();
    const track = this.queue.advance(advance);
    if (!track) {
      this.armIdleTimer();
      return;
    }
    this.clearTimer('idle');
    this.retries = 0;
    this.startStream(track);
    const quiet = this.quietNextStart;
    this.quietNextStart = false;
    this.startedTrack = track;
    this.emit('trackStarted', (events) => events.trackStarted?.(this, track, announce && !quiet));
  }

  private finishTrack(): void {
    const track = this.startedTrack;
    if (!track) return;
    this.startedTrack = null;
    this.emit('trackFinished', (events) => events.trackFinished?.(this, track));
  }

  /** Falha na interface (ex.: Discord fora) nunca pode derrubar a reprodução. */
  private emit(name: string, call: (events: PlayerEvents) => void): void {
    try {
      call(this.deps.events);
    } catch (error) {
      this.log.warn({ err: error, event: name }, 'player event listener failed');
    }
  }

  private startStream(track: Track): void {
    const stream = this.deps.youtube.createStream(track);
    stream.resource.volume?.setVolumeLogarithmic(this.volumePercent / 100);
    this.active = stream;
    this.audioPlayer.play(stream.resource);
    this.log.info({ trackId: track.id, title: track.title, attempt: this.retries + 1 }, 'track started');
  }

  private async onTrackEnd(): Promise<void> {
    const stream = this.active;
    const track = this.queue.current;
    const requested = this.pendingAdvance;
    this.active = null;
    this.pendingAdvance = null;

    let failure: YtError | null = null;
    if (stream) {
      if (!requested) failure = await stream.failure(FAILURE_GRACE_MS);
      stream.kill();
    }
    if (this.destroyed) return;

    if (stream && track) {
      const playedSec = Math.round(stream.resource.playbackDuration / 1000);
      const endedBy = requested ? (requested.drop ? 'stop' : 'skip') : failure ? `failure:${failure.code}` : 'natural';
      this.log.info({ trackId: track.id, playedSec, durationSec: track.durationSec, endedBy }, 'track ended');
      // Fim "natural" bem antes da duração conhecida: corte silencioso do stream; loga o estado dos processos.
      if (endedBy === 'natural' && track.durationSec !== null && playedSec < track.durationSec - EARLY_END_TOLERANCE_SEC) {
        this.log.warn({ trackId: track.id, playedSec, durationSec: track.durationSec, pipeline: stream.diagnostics() }, 'track ended early');
      }
    }

    if (failure && track) {
      const playedMs = stream?.resource.playbackDuration ?? 0;
      if (failure.retriable && playedMs < EARLY_FAILURE_MS && this.retries < MAX_STREAM_RETRIES) {
        this.retries++;
        this.log.warn({ trackId: track.id, ytCode: failure.code, retry: this.retries }, 'stream failed before audio, retrying');
        this.startStream(track);
        return;
      }
      const prefix =
        playedMs < EARLY_FAILURE_MS ? `⚠️ Pulei ${trackLink(track)}` : `⚠️ ${trackLink(track)} foi interrompida`;
      void this.notify(`${prefix}: ${failure.userMessage}.`);
    }

    // Falha conta como skip + drop: evita loop infinito tentando tocar a mesma faixa quebrada.
    this.playNext(requested ?? (failure ? { skip: true, drop: true } : { skip: false, drop: false }));
  }

  private onConnectionState(status: VoiceConnectionStatus): void {
    if (this.destroyed) return;
    if (status === VoiceConnectionStatus.Ready) {
      this.notReadySince = null;
      this.rejoins = 0;
      if (this.readyWatchdog) clearTimeout(this.readyWatchdog);
      this.readyWatchdog = null;
      return;
    }
    this.notReadySince ??= Date.now();
    this.armReadyWatchdog();
  }

  /** Cobre o caso em que a lib começa a reconectar e trava em Signalling/Connecting. */
  private armReadyWatchdog(): void {
    if (this.readyWatchdog || this.destroyed) return;
    this.readyWatchdog = setTimeout(() => {
      this.readyWatchdog = null;
      if (this.destroyed || this.connection.state.status === VoiceConnectionStatus.Ready) return;
      if (this.rejoins < MAX_REJOINS) {
        this.rejoins++;
        this.log.warn({ status: this.connection.state.status, attempt: this.rejoins }, 'voice connection stuck, rejoining');
        this.connection.rejoin();
        this.armReadyWatchdog();
        return;
      }
      this.log.warn({ status: this.connection.state.status }, 'voice connection did not recover');
      void this.notify('🔌 Perdi a conexão de voz e não consegui reconectar. Use `/play` para me chamar de novo.');
      this.destroy('voice connection stuck');
    }, READY_WATCHDOG_MS);
  }

  private async onDisconnected(): Promise<void> {
    try {
      // Signalling/Connecting em seguida = movido de canal ou queda recuperável.
      await Promise.race([
        entersState(this.connection, VoiceConnectionStatus.Signalling, RECONNECT_TIMEOUT_MS),
        entersState(this.connection, VoiceConnectionStatus.Connecting, RECONNECT_TIMEOUT_MS),
      ]);
    } catch {
      if (this.destroyed) return;
      void this.notify('🔌 Fui desconectado do canal de voz.');
      this.destroy('disconnected');
    }
  }

  private armIdleTimer(): void {
    if (this.destroyed || this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      void this.notify('💤 Fila vazia há um tempo, saindo do canal.');
      this.destroy('idle timeout');
    }, this.deps.config.idleTimeoutMs);
  }

  private clearTimer(which: 'idle' | 'alone'): void {
    const timer = which === 'idle' ? this.idleTimer : this.aloneTimer;
    if (timer) clearTimeout(timer);
    if (which === 'idle') this.idleTimer = null;
    else this.aloneTimer = null;
  }

  private async notify(content: string): Promise<void> {
    try {
      await this.textChannel.send({ content, flags: MessageFlags.SuppressEmbeds, allowedMentions: { parse: [] } });
    } catch (error) {
      this.log.warn({ err: error, channelId: this.textChannel.id }, 'failed to send notification');
    }
  }
}
