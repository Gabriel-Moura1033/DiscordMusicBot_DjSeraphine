import { createAudioResource, StreamType, type AudioResource } from '@discordjs/voice';
import type { Config } from '../config.js';
import { logger } from '../logger.js';
import { formatDuration } from '../util/format.js';
import { getNumber, getRecords, getString, parseJsonRecord, type JsonRecord } from '../util/json.js';
import { isFilterRejection, YtError, ytErrorFromStderr } from './errors.js';
import { runCapture, spawnPipeline, type PipelineResult } from './process.js';
import { videoUrl, type ResolvableInput } from './url.js';

export interface TrackInfo {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly durationSec: number | null;
  readonly uploader: string | null;
}

export interface Track extends TrackInfo {
  readonly requestedBy: { readonly id: string; readonly name: string };
  /** Escolhida pelo autoplay a partir do mix desta faixa (título da semente). */
  readonly autoplayFrom?: string;
}

export type ResolveResult =
  | { readonly kind: 'single'; readonly track: TrackInfo; readonly fromSearch: boolean }
  | {
      readonly kind: 'playlist';
      readonly title: string;
      readonly url: string;
      readonly tracks: readonly TrackInfo[];
      /** Itens ignorados: privados, removidos, ao vivo ou longos demais. */
      readonly skipped: number;
      /** A playlist tem mais itens que `MAX_PLAYLIST_SIZE`. */
      readonly truncated: boolean;
    };

export interface ActiveStream {
  readonly resource: AudioResource<Track>;
  kill(): void;
  /**
   * Espera o pipeline terminar (até `timeoutMs`) e diz por que a faixa falhou.
   * `null` = terminou normalmente, foi morta por nós ou ainda não terminou no prazo.
   */
  failure(timeoutMs: number): Promise<YtError | null>;
  /** Estado dos processos para log; `null` enquanto o pipeline ainda não terminou. */
  diagnostics(): StreamDiagnostics | null;
}

export interface StreamDiagnostics {
  readonly killed: boolean;
  readonly ytdlp: { readonly code: number | null; readonly signal: string | null; readonly stderrTail: string };
  readonly ffmpeg: { readonly code: number | null; readonly signal: string | null; readonly stderrTail: string };
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const RESOLVE_TIMEOUT_MS = 30_000;
const PLAYLIST_TIMEOUT_MS = 90_000;
const MAX_JSON_BYTES = 32 * 1024 * 1024;

/**
 * `-ss` antes do `-i` num pipe: o ffmpeg decodifica e descarta até o ponto (exato). Medido mais
 * rápido e confiável que `--download-sections` do yt-dlp, que corta só em início de cluster e
 * falha com m4a em stdout (ADR-035).
 */
function ffmpegArgs(startSec: number): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    ...(startSec > 0 ? ['-ss', String(startSec)] : []),
    '-i', 'pipe:0',
    '-vn',
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1',
  ];
}

function isLive(entry: JsonRecord): boolean {
  const status = getString(entry, 'live_status');
  return entry['is_live'] === true || status === 'is_live' || status === 'is_upcoming';
}

function isUnplayableEntry(entry: JsonRecord): boolean {
  const title = getString(entry, 'title') ?? '';
  const availability = getString(entry, 'availability');
  return (
    title === '[Private video]' ||
    title === '[Deleted video]' ||
    (availability !== null && availability !== 'public' && availability !== 'unlisted')
  );
}

function toTrackInfo(entry: JsonRecord): TrackInfo | null {
  const id = getString(entry, 'id');
  if (!id || !VIDEO_ID.test(id)) return null;
  return {
    id,
    url: videoUrl(id),
    title: getString(entry, 'title') ?? id,
    durationSec: getNumber(entry, 'duration'),
    uploader: getString(entry, 'uploader') ?? getString(entry, 'channel'),
  };
}

/** Entradas tocáveis de um resultado flat (busca, mix): sem lives, privados ou acima do limite de duração. */
export function playableEntries(json: JsonRecord, maxDurationSec: number): TrackInfo[] {
  const tracks: TrackInfo[] = [];
  for (const entry of getRecords(json, 'entries')) {
    const track = toTrackInfo(entry);
    if (!track || isLive(entry) || isUnplayableEntry(entry)) continue;
    if (track.durationSec !== null && track.durationSec > maxDurationSec) continue;
    tracks.push(track);
  }
  return tracks;
}

/** Tamanho do mix pedido ao YouTube para o autoplay (ordem de relevância). */
const MIX_SIZE = 25;

export class YouTubeService {
  constructor(private readonly config: Config) {}

  async resolve(input: ResolvableInput): Promise<ResolveResult> {
    switch (input.kind) {
      case 'video':
        return { kind: 'single', track: await this.resolveVideo(input.url), fromSearch: false };
      case 'search':
        return { kind: 'single', track: await this.resolveSearch(input.query), fromSearch: true };
      case 'playlist':
        return this.resolvePlaylist(input.url);
    }
  }

  /** `startSec` > 0 começa a faixa nesse ponto (/seek). */
  createStream(track: Track, startSec = 0): ActiveStream {
    const pipeline = spawnPipeline(
      {
        command: this.config.ytdlpPath,
        args: [
          '--format', 'bestaudio/best',
          '--no-playlist',
          '--no-progress',
          '--match-filter', `!is_live & duration <= ${this.config.maxTrackDurationSec}`,
          '--output', '-',
          '--',
          track.url,
        ],
      },
      { command: this.config.ffmpegPath, args: ffmpegArgs(startSec) },
    );

    const resource = createAudioResource(pipeline.output, {
      inputType: StreamType.Raw,
      inlineVolume: true,
      metadata: track,
    });

    let settled: YtError | null | undefined;
    let finished: PipelineResult | null = null;
    const outcome = pipeline.done.then((result) => {
      finished = result;
      settled = this.interpretPipeline(track, result);
      return settled;
    });

    return {
      resource,
      kill: pipeline.kill,
      diagnostics: () => {
        if (!finished) return null;
        const { killed, source, decoder } = finished;
        return {
          killed,
          ytdlp: { code: source.code, signal: source.signal, stderrTail: source.stderr.slice(-1500) },
          ffmpeg: { code: decoder.code, signal: decoder.signal, stderrTail: decoder.stderr.slice(-1500) },
        };
      },
      failure: async (timeoutMs) => {
        if (settled !== undefined) return settled;
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs);
        });
        try {
          return await Promise.race([outcome, timeout]);
        } finally {
          clearTimeout(timer);
        }
      },
    };
  }

  private interpretPipeline(track: Track, result: PipelineResult): YtError | null {
    if (result.killed) return null;
    const { source, decoder } = result;
    const log = logger.child({ trackId: track.id });

    if (source.spawnError || decoder.spawnError) {
      log.error({ err: source.spawnError ?? decoder.spawnError }, 'failed to spawn yt-dlp/ffmpeg');
      return new YtError('unknown', 'yt-dlp ou ffmpeg não foram encontrados no servidor');
    }
    if (source.code !== 0) {
      const error = ytErrorFromStderr(source.stderr);
      log.warn({ code: source.code, ytCode: error.code, stderr: source.stderr.slice(-2000) }, 'yt-dlp stream failed');
      return error;
    }
    if (isFilterRejection(source.stderr)) {
      return new YtError(
        'too_long',
        `é uma transmissão ao vivo ou passa do limite de ${formatDuration(this.config.maxTrackDurationSec)}`,
      );
    }
    if (decoder.code !== 0) {
      log.warn({ code: decoder.code, stderr: decoder.stderr.slice(-2000) }, 'ffmpeg failed');
      return new YtError('unknown', 'falha ao decodificar o áudio');
    }
    return null;
  }

  private async runJson(args: readonly string[], timeoutMs: number): Promise<JsonRecord> {
    const result = await runCapture(this.config.ytdlpPath, ['--dump-single-json', '--no-warnings', ...args], {
      timeoutMs,
      maxStdoutBytes: MAX_JSON_BYTES,
    });

    if (result.spawnError) {
      logger.error({ err: result.spawnError }, 'failed to spawn yt-dlp');
      throw new YtError('unknown', 'o yt-dlp não foi encontrado no servidor');
    }
    if (result.timedOut) throw new YtError('timeout');
    if (result.code !== 0) {
      const error = ytErrorFromStderr(result.stderr);
      logger.warn({ args, code: result.code, ytCode: error.code, stderr: result.stderr.slice(-2000) }, 'yt-dlp resolve failed');
      throw error;
    }

    const json = parseJsonRecord(result.stdout);
    if (!json) {
      logger.error({ args, stdoutHead: result.stdout.slice(0, 500) }, 'yt-dlp returned invalid JSON');
      throw new YtError('unknown', 'resposta inválida do yt-dlp');
    }
    return json;
  }

  private assertPlayable(entry: JsonRecord, track: TrackInfo): void {
    if (isLive(entry)) throw new YtError('live');
    if (track.durationSec !== null && track.durationSec > this.config.maxTrackDurationSec) {
      throw new YtError(
        'too_long',
        `o vídeo tem ${formatDuration(track.durationSec)} e o limite é ${formatDuration(this.config.maxTrackDurationSec)}`,
      );
    }
  }

  private async resolveVideo(url: string): Promise<TrackInfo> {
    const json = await this.runJson(['--no-playlist', '--skip-download', '--', url], RESOLVE_TIMEOUT_MS);
    const track = toTrackInfo(json);
    if (!track) throw new YtError('unknown', 'o yt-dlp não retornou um ID de vídeo válido');
    this.assertPlayable(json, track);
    return track;
  }

  private async resolveSearch(query: string): Promise<TrackInfo> {
    const json = await this.runJson(['--flat-playlist', '--', `ytsearch1:${query}`], RESOLVE_TIMEOUT_MS);
    const entry = getRecords(json, 'entries')[0];
    const track = entry ? toTrackInfo(entry) : null;
    if (!entry || !track) throw new YtError('not_found', `nenhum resultado para "${query}"`);
    this.assertPlayable(entry, track);
    return track;
  }

  /** Até `limit` resultados tocáveis (sem lives nem vídeos acima do limite de duração). */
  async search(query: string, limit: number, timeoutMs = RESOLVE_TIMEOUT_MS): Promise<TrackInfo[]> {
    const json = await this.runJson(['--flat-playlist', '--', `ytsearch${limit}:${query}`], timeoutMs);
    return playableEntries(json, this.config.maxTrackDurationSec);
  }

  /** Mix do YouTube (`list=RD<id>`) do vídeo: relacionados em ordem de relevância; o 1º é o próprio vídeo. */
  async mix(videoId: string): Promise<TrackInfo[]> {
    if (!VIDEO_ID.test(videoId)) throw new YtError('unknown', 'ID de vídeo inválido para o autoplay');
    const url = `${videoUrl(videoId)}&list=RD${videoId}`;
    const json = await this.runJson(
      ['--flat-playlist', '--yes-playlist', '--playlist-end', String(MIX_SIZE), '--', url],
      RESOLVE_TIMEOUT_MS,
    );
    return playableEntries(json, this.config.maxTrackDurationSec);
  }

  private async resolvePlaylist(url: string): Promise<ResolveResult> {
    const max = this.config.maxPlaylistSize;
    // Pede um item a mais só para saber se a playlist foi truncada.
    const json = await this.runJson(
      ['--flat-playlist', '--playlist-end', String(max + 1), '--', url],
      PLAYLIST_TIMEOUT_MS,
    );

    const entries = getRecords(json, 'entries');
    const totalCount = getNumber(json, 'playlist_count');
    const truncated = entries.length > max || (totalCount !== null && totalCount > max);

    const tracks: TrackInfo[] = [];
    let skipped = 0;
    for (const entry of entries.slice(0, max)) {
      const track = toTrackInfo(entry);
      const tooLong = track?.durationSec != null && track.durationSec > this.config.maxTrackDurationSec;
      if (!track || isUnplayableEntry(entry) || isLive(entry) || tooLong) {
        skipped++;
        continue;
      }
      tracks.push(track);
    }

    if (tracks.length === 0) {
      throw new YtError('not_found', 'a playlist está vazia ou nenhum vídeo dela pode ser tocado');
    }

    return {
      kind: 'playlist',
      title: getString(json, 'title') ?? 'Playlist',
      url,
      tracks,
      skipped,
      truncated,
    };
  }

  async version(): Promise<string | null> {
    const result = await runCapture(this.config.ytdlpPath, ['--version'], { timeoutMs: 15_000, maxStdoutBytes: 4096 });
    return result.code === 0 ? result.stdout.trim() : null;
  }
}
