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
import { YtError } from '../youtube/errors.js';
import type { ActiveStream, Track, TrackInfo, YouTubeService } from '../youtube/YouTubeService.js';
import { AUTOPLAY_REQUESTER, buildAvoid, pickAutoplayCandidate, queueEndAction, RecentTracks } from './autoplay.js';
import { History } from './History.js';
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
/** Quanto esperar o primeiro áudio do novo stream num /seek antes de desistir (o antigo segue tocando). */
const SEEK_TIMEOUT_MS = 30_000;

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

export type SeekResult =
  | { readonly status: 'ok' }
  /** Nada tocando. */
  | { readonly status: 'idle' }
  /** Troca de faixa em andamento (entre o fim de uma e o início da próxima). */
  | { readonly status: 'busy' }
  /** A faixa mudou ou outro /seek começou enquanto este esperava o áudio. */
  | { readonly status: 'superseded' }
  | { readonly status: 'failed'; readonly error: YtError };

/** Espera o novo stream ter áudio pronto, falhar ou estourar o prazo. */
export function waitForAudio(stream: ActiveStream, timeoutMs: number): Promise<'ready' | 'timeout' | YtError> {
  const playStream = stream.resource.playStream;
  return new Promise((resolve) => {
    const finish = (outcome: 'ready' | 'timeout' | YtError): void => {
      clearTimeout(timer);
      playStream.off('readable', onReadable);
      resolve(outcome);
    };
    // 'readable' também dispara no fim do stream: sem dados = o pipeline acabou sem áudio (ex.: vídeo indisponível).
    const onReadable = (): void => {
      if (playStream.readableLength > 0) {
        finish('ready');
        return;
      }
      void stream.failure(FAILURE_GRACE_MS).then((error) => finish(error ?? new YtError('unknown', 'o stream terminou sem áudio')));
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    playStream.once('readable', onReadable);
    void stream.failure(timeoutMs).then((error) => {
      if (error) finish(error);
    });
  });
}

function autoplayExhaustedMessage(seed: Track): string {
  return `🤖 Autoplay: não achei uma próxima faixa a partir de ${trackLink(seed)} que ainda não tenha tocado. Use \`/play\` para continuar.`;
}

export class VoiceConnectError extends Error {
  override readonly name = 'VoiceConnectError';
}

export class GuildPlayer {
  readonly queue = new Queue();
  readonly history: History;
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
  /** Posição (s) em que o stream atual começou; > 0 depois de um /seek. */
  private startOffsetSec = 0;
  private seekGeneration = 0;
  /** /previous: a faixa interrompida volta para a fila, não para o histórico. */
  private skipHistoryOnce = false;
  /** /stop: o próximo fim de fila não aciona o autoplay. */
  private stopRequested = false;
  private autoplayEnabled: boolean;
  private readonly autoplayRecent: RecentTracks<Track>;
  /** Incrementado para invalidar buscas de mix em andamento (/stop, desligar, destroy). */
  private autoplayGeneration = 0;
  private autoplayPending: { readonly seed: Track; readonly generation: number } | null = null;
  /** Semente cujo mix não rendeu faixa; evita buscar de novo no fim da fila. */
  private autoplayFailedSeedId: string | null = null;

  private constructor(
    private readonly guild: Guild,
    private readonly connection: VoiceConnection,
    /** Onde os avisos (tocando agora, erros, saída) são enviados; atualizado a cada /play. */
    public textChannel: GuildTextBasedChannel,
    private readonly deps: GuildPlayerDeps,
  ) {
    this.log = logger.child({ guildId: guild.id });
    this.volumePercent = deps.config.defaultVolume;
    this.history = new History(deps.config.historySize);
    this.autoplayEnabled = deps.config.autoplayDefault;
    this.autoplayRecent = new RecentTracks(deps.config.autoplayRecentLimit);
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

  get autoplay(): boolean {
    return this.autoplayEnabled;
  }

  /**
   * Liga/desliga o autoplay. Ligar já busca a próxima se a fila estiver no fim; desligar cancela a
   * busca e tira da fila as faixas que o autoplay tinha colocado. Retorna quantas saíram.
   */
  setAutoplay(enabled: boolean): number {
    this.autoplayEnabled = enabled;
    if (!enabled) {
      this.cancelAutoplay();
      const removed = this.queue.removeWhere((track) => track.autoplayFrom !== undefined);
      if (!this.queue.current) this.armIdleTimer();
      return removed;
    }
    this.autoplayFailedSeedId = null;
    if (this.queue.current) {
      this.maybePrefetchAutoplay();
    } else {
      // Fila já acabou: começa pelo mix da última faixa tocada.
      const seed = this.history.entries[0];
      if (seed) this.fetchAutoplay(seed);
    }
    return 0;
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
      elapsedSec: this.startOffsetSec + (this.active?.resource.playbackDuration ?? 0) / 1000,
      paused: this.audioPlayer.state.status === AudioPlayerStatus.Paused,
    };
  }

  skip(): Track | null {
    const current = this.queue.current;
    if (!current) return null;
    this.stopCurrent({ skip: true, drop: false });
    return current;
  }

  /** Pula direto para a posição `position` da fila (1-based), como /skip repetido. */
  skipTo(position: number): { readonly track: Track; readonly skipped: number } | 'busy' | null {
    if (!this.queue.current) return null;
    if (this.isChangingTrack()) return 'busy';
    const target = this.queue.upcoming[position - 1];
    const skipped = this.queue.prepareSkipTo(position);
    if (!target || skipped === null) return null;
    // drop: prepareSkipTo já reposicionou a atual no loop de fila.
    this.stopCurrent({ skip: true, drop: true });
    return { track: target, skipped };
  }

  /**
   * Volta para a última faixa do histórico; a atual vai para o início da fila (dá para avançar de
   * novo). Sem nada tocando, só toca a anterior. `null` = histórico vazio.
   */
  previous(): Track | 'busy' | null {
    const current = this.queue.current;
    if (current && this.isChangingTrack()) return 'busy';
    const previous = this.history.pop();
    if (!previous) return null;
    if (!current) {
      this.enqueue([previous]);
      return previous;
    }
    this.queue.addFront([previous, current]);
    this.skipHistoryOnce = true;
    this.stopCurrent({ skip: true, drop: true });
    return previous;
  }

  /**
   * Recomeça a faixa atual em `positionSec`. O stream novo só substitui o antigo quando tem áudio
   * pronto: até lá (ou se falhar) a música continua de onde estava. Despausa.
   */
  async seek(positionSec: number): Promise<SeekResult> {
    const track = this.queue.current;
    const before = this.active;
    if (!track || !before) return { status: 'idle' };
    if (this.isChangingTrack()) return { status: 'busy' };

    const generation = ++this.seekGeneration;
    // Mesmas novas tentativas silenciosas da reprodução normal (ex.: 403 intermitente, P-011).
    for (let attempt = 1; ; attempt++) {
      const stream = this.deps.youtube.createStream(track, positionSec);
      stream.resource.volume?.setVolumeLogarithmic(this.volumePercent / 100);
      const outcome = await waitForAudio(stream, SEEK_TIMEOUT_MS);

      if (this.destroyed || generation !== this.seekGeneration || this.active !== before) {
        stream.kill();
        return { status: 'superseded' };
      }
      if (outcome === 'ready' && !stream.resource.ended) {
        this.swapStream(track, stream, before, positionSec);
        return { status: 'ok' };
      }
      stream.kill();
      const error = outcome instanceof YtError ? outcome : new YtError('timeout', 'o YouTube demorou demais para responder');
      if (error.retriable && attempt <= MAX_STREAM_RETRIES) {
        this.log.warn({ trackId: track.id, positionSec, ytCode: error.code, retry: attempt }, 'seek stream failed, retrying');
        continue;
      }
      this.log.warn({ trackId: track.id, positionSec, ytCode: error.code }, 'seek failed');
      return { status: 'failed', error };
    }
  }

  private swapStream(track: Track, stream: ActiveStream, before: ActiveStream, positionSec: number): void {
    // play() com outro recurso vai direto para Buffering/Playing (sem Idle), então onTrackEnd não dispara.
    this.active = stream;
    this.startOffsetSec = positionSec;
    this.retries = 0;
    this.audioPlayer.play(stream.resource);
    before.kill();
    this.log.info({ trackId: track.id, positionSec }, 'track seeked');
  }

  stop(): void {
    this.queue.clearUpcoming();
    this.queue.loopMode = 'off';
    this.cancelAutoplay();
    if (this.queue.current) {
      this.stopRequested = true;
      this.stopCurrent({ skip: true, drop: true });
    }
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
    this.cancelAutoplay();
    this.queue.reset();
    this.active?.kill();
    this.active = null;
    this.audioPlayer.stop(true);
    if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
    this.deps.onDestroyed(this.guild.id);
    this.log.info({ reason }, 'guild player destroyed');
  }

  /** Entre o fim de uma faixa e o início da próxima (onTrackEnd pode estar esperando o yt-dlp sair). */
  private isChangingTrack(): boolean {
    return this.queue.current !== null && this.audioPlayer.state.status === AudioPlayerStatus.Idle;
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
    const previous = this.queue.current;
    const stopped = this.stopRequested;
    this.stopRequested = false;
    const track = this.queue.advance(advance);
    if (!track) {
      this.onQueueEnd(previous ?? this.history.entries[0] ?? null, stopped);
      return;
    }
    this.clearTimer('idle');
    this.retries = 0;
    this.startOffsetSec = 0;
    this.startStream(track);
    const quiet = this.quietNextStart;
    this.quietNextStart = false;
    this.startedTrack = track;
    this.emit('trackStarted', (events) => events.trackStarted?.(this, track, announce && !quiet));
    this.maybePrefetchAutoplay();
  }

  /** Fila acabou: autoplay (se ligado) ou timer de inatividade (ADR-037). */
  private onQueueEnd(seed: Track | null, stopped: boolean): void {
    const action = queueEndAction({
      enabled: this.autoplayEnabled,
      stopped,
      seedId: seed?.id ?? null,
      pendingSeedId: this.autoplayPending?.seed.id ?? null,
      failedSeedId: this.autoplayFailedSeedId,
    });
    if (action === 'fetch' && seed) {
      this.fetchAutoplay(seed);
      return;
    }
    if (action === 'wait') return;
    if (action === 'exhausted' && seed) void this.notify(autoplayExhaustedMessage(seed));
    this.armIdleTimer();
  }

  /** Começou a tocar a última faixa da fila: já busca a próxima, para não haver silêncio entre as duas. */
  private maybePrefetchAutoplay(): void {
    const current = this.queue.current;
    if (!this.autoplayEnabled || !current || this.queue.size > 0 || this.queue.loopMode !== 'off') return;
    if (this.autoplayPending?.seed === current) return;
    this.fetchAutoplay(current);
  }

  private fetchAutoplay(seed: Track): void {
    const generation = ++this.autoplayGeneration;
    this.autoplayPending = { seed, generation };
    // Fila parada esperando o mix: o timer de inatividade não pode correr.
    if (!this.queue.current) this.clearTimer('idle');
    this.log.info({ seedId: seed.id }, 'autoplay: fetching mix');
    this.deps.youtube
      .mix(seed.id)
      .catch((error: unknown) => {
        this.log.warn({ err: error, seedId: seed.id }, 'autoplay: mix failed');
        return null;
      })
      .then((candidates) => this.onAutoplayResult(seed, generation, candidates))
      .catch((error: unknown) => this.log.error({ err: error }, 'autoplay: unexpected error'));
  }

  private onAutoplayResult(seed: Track, generation: number, candidates: readonly TrackInfo[] | null): void {
    if (this.destroyed || generation !== this.autoplayGeneration) return;
    this.autoplayPending = null;
    if (!this.autoplayEnabled) return;

    const current = this.queue.current;
    const waiting = current === null;
    // A fila mudou durante a busca (faixa nova ou /play): a próxima "última faixa" busca de novo.
    if (!waiting && (current !== seed || this.queue.size > 0)) return;

    const avoid = buildAvoid([
      ...this.history.entries,
      ...this.autoplayRecent.entries,
      ...this.queue.upcoming,
      ...(current ? [current] : []),
      seed,
    ]);
    const pick = candidates ? pickAutoplayCandidate(candidates, avoid, this.deps.config.maxTrackDurationSec) : null;
    if (!pick) {
      this.autoplayFailedSeedId = seed.id;
      this.log.info({ seedId: seed.id, candidates: candidates?.length ?? null }, 'autoplay: no candidate');
      if (waiting) {
        void this.notify(autoplayExhaustedMessage(seed));
        this.armIdleTimer();
      }
      return;
    }

    const track: Track = {
      ...pick,
      requestedBy: { id: this.guild.members.me?.id ?? '0', name: AUTOPLAY_REQUESTER },
      autoplayFrom: seed.title,
    };
    this.autoplayRecent.push(track);
    this.queue.add([track]);
    this.log.info({ seedId: seed.id, trackId: track.id, title: track.title }, 'autoplay: track queued');
    if (waiting) this.playNext({ skip: false, drop: false });
  }

  private cancelAutoplay(): void {
    this.autoplayGeneration++;
    this.autoplayPending = null;
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
    const stream = this.deps.youtube.createStream(track, this.startOffsetSec);
    stream.resource.volume?.setVolumeLogarithmic(this.volumePercent / 100);
    this.active = stream;
    this.audioPlayer.play(stream.resource);
    this.log.info({ trackId: track.id, title: track.title, attempt: this.retries + 1 }, 'track started');
  }

  private async onTrackEnd(): Promise<void> {
    const stream = this.active;
    const track = this.queue.current;
    const requested = this.pendingAdvance;
    const keepOutOfHistory = this.skipHistoryOnce;
    this.active = null;
    this.pendingAdvance = null;
    this.skipHistoryOnce = false;

    let failure: YtError | null = null;
    if (stream) {
      if (!requested) failure = await stream.failure(FAILURE_GRACE_MS);
      stream.kill();
    }
    if (this.destroyed) return;

    if (stream && track) {
      const playedSec = Math.round(this.startOffsetSec + stream.resource.playbackDuration / 1000);
      const endedBy = requested ? (requested.drop ? 'stop' : 'skip') : failure ? `failure:${failure.code}` : 'natural';
      this.log.info({ trackId: track.id, playedSec, durationSec: track.durationSec, endedBy }, 'track ended');
      // Fim "natural" bem antes da duração conhecida: corte silencioso do stream; loga o estado dos processos.
      if (endedBy === 'natural' && track.durationSec !== null && playedSec < track.durationSec - EARLY_END_TOLERANCE_SEC) {
        this.log.warn({ trackId: track.id, playedSec, durationSec: track.durationSec, pipeline: stream.diagnostics() }, 'track ended early');
      }
      // Só entra no histórico o que chegou a tocar (falha antes do áudio não conta).
      if (stream.resource.playbackDuration > 0 && !keepOutOfHistory) this.history.push(track);
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
