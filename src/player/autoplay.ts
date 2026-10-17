import type { TrackInfo } from '../youtube/YouTubeService.js';

/** `requestedBy.name` das faixas escolhidas pelo autoplay (exibidas como "Recomendado pela DJ Seraphine"). */
export const AUTOPLAY_REQUESTER = 'DJ Seraphine';

/** Palavras que só distinguem versões do mesmo vídeo ("Official Video" × "Lyrics"). */
const NOISE_WORDS = new Set([
  'official', 'oficial', 'video', 'vídeo', 'videoclipe', 'clipe', 'clip', 'audio', 'áudio', 'music', 'musica', 'música',
  'lyrics', 'lyric', 'letra', 'legendado', 'remastered', 'remaster', 'remasterizado', 'hd', 'hq', '4k', 'mv', 'visualizer',
  'version', 'versão', 'live', 'ao', 'vivo', 'topic',
]);

/**
 * Chave para reconhecer a mesma música em vídeos diferentes: sem parênteses/colchetes, sem "feat.",
 * sem acentos, pontuação e palavras de versão. "Queen – Bohemian Rhapsody (Official Video Remastered)"
 * e "Queen - Bohemian Rhapsody [Lyrics]" viram "queen bohemian rhapsody".
 */
export function titleKey(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]|【[^】]*】/g, ' ')
    .replace(/\b(feat|ft|featuring)\b\.?.*$/, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((word) => word !== '' && !NOISE_WORDS.has(word));
  return words.join(' ');
}

export interface AutoplayAvoid {
  readonly ids: ReadonlySet<string>;
  readonly titles: ReadonlySet<string>;
}

export function buildAvoid(tracks: Iterable<{ readonly id: string; readonly title: string }>): AutoplayAvoid {
  const ids = new Set<string>();
  const titles = new Set<string>();
  for (const track of tracks) {
    ids.add(track.id);
    const key = titleKey(track.title);
    if (key) titles.add(key);
  }
  return { ids, titles };
}

/** Primeiro candidato do mix (ordem de relevância) que não repete nada recente e cabe no limite de duração. */
export function pickAutoplayCandidate(
  candidates: readonly TrackInfo[],
  avoid: AutoplayAvoid,
  maxDurationSec: number,
): TrackInfo | null {
  for (const candidate of candidates) {
    if (avoid.ids.has(candidate.id)) continue;
    // Sem duração no mix costuma ser live/estreia; não vale o risco.
    if (candidate.durationSec === null || candidate.durationSec > maxDurationSec) continue;
    const key = titleKey(candidate.title);
    if (key && avoid.titles.has(key)) continue;
    return candidate;
  }
  return null;
}

export type QueueEndAction =
  /** Arma o timer de inatividade normalmente. */
  | 'idle'
  /** Já há uma busca para essa semente; espera o resultado (sem timer). */
  | 'wait'
  /** Busca o mix da semente agora (sem timer). */
  | 'fetch'
  /** A busca para essa semente já falhou: avisa e arma o timer. */
  | 'exhausted';

/** O que fazer quando a fila acaba (ADR-037: o timer de inatividade não corre enquanto o autoplay alimenta a fila). */
export function queueEndAction(state: {
  readonly enabled: boolean;
  /** /stop e /leave não acionam o autoplay. */
  readonly stopped: boolean;
  readonly seedId: string | null;
  readonly pendingSeedId: string | null;
  readonly failedSeedId: string | null;
}): QueueEndAction {
  if (!state.enabled || state.stopped || state.seedId === null) return 'idle';
  if (state.pendingSeedId === state.seedId) return 'wait';
  if (state.failedSeedId === state.seedId) return 'exhausted';
  return 'fetch';
}

/** Lista circular das últimas faixas escolhidas pelo autoplay (evita voltar a elas além do histórico). */
export class RecentTracks<T extends { readonly id: string; readonly title: string }> {
  private items: T[] = [];

  constructor(private readonly maxSize: number) {}

  get entries(): readonly T[] {
    return this.items;
  }

  push(track: T): void {
    this.items.unshift(track);
    if (this.items.length > this.maxSize) this.items.length = this.maxSize;
  }
}
