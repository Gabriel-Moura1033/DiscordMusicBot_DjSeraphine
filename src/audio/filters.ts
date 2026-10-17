/**
 * Cadeia `-af` do ffmpeg e a conversão entre "tempo tocado" e "posição no vídeo". Tudo puro.
 * Ordem: corte do SponsorBlock (no tempo do vídeo) → efeito do /filtro → loudnorm (ADR-038/039).
 */

export const FILTER_NAMES = ['nenhum', 'bassboost', 'nightcore', '8d'] as const;
export type FilterName = (typeof FILTER_NAMES)[number];

export function isFilterName(value: string): value is FilterName {
  return (FILTER_NAMES as readonly string[]).includes(value);
}

export const FILTER_LABELS: Record<FilterName, string> = {
  nenhum: 'nenhum',
  bassboost: '🔊 bass boost',
  nightcore: '🐿️ nightcore',
  '8d': '🎧 8D',
};

/** Velocidade de reprodução de cada filtro (nightcore acelera). */
export const FILTER_SPEED: Record<FilterName, number> = { nenhum: 1, bassboost: 1, nightcore: 1.25, '8d': 1 };

const EFFECTS: Record<FilterName, string | null> = {
  nenhum: null,
  // Limitador evita clipping com o ganho de grave.
  bassboost: 'bass=g=8:f=110:w=0.6,alimiter=limit=0.95',
  // aresample antes: asetrate assume a taxa de entrada (m4a vem em 44,1 kHz).
  nightcore: 'aresample=48000,asetrate=48000*1.25,aresample=48000',
  '8d': 'apulsator=hz=0.125',
};

const LOUDNORM = 'loudnorm=I=-16:TP=-1.5:LRA=11';

/** Trecho em segundos no tempo do vídeo original. */
export interface Segment {
  readonly start: number;
  readonly end: number;
}

export interface StreamPlan {
  /** Posição no vídeo onde o stream começa (`-ss`). */
  readonly startSec: number;
  /** Trechos removidos (ordenados, sem sobreposição). */
  readonly segments: readonly Segment[];
  readonly filter: FilterName;
  readonly loudnorm: boolean;
}

export function plainPlan(startSec = 0): StreamPlan {
  return { startSec, segments: [], filter: 'nenhum', loudnorm: false };
}

function seconds(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** `null` = sem filtro. Depois de `-ss`, o `t` do aselect conta a partir do ponto de seek. */
export function buildAudioFilter(plan: StreamPlan): string | null {
  const parts: string[] = [];
  const cuts = plan.segments
    .filter((segment) => segment.end > plan.startSec)
    .map((segment) => ({ start: Math.max(0, segment.start - plan.startSec), end: segment.end - plan.startSec }));
  if (cuts.length > 0) {
    const ranges = cuts.map((cut) => `between(t,${seconds(cut.start)},${seconds(cut.end)})`).join('+');
    parts.push(`aselect='not(${ranges})'`, 'asetpts=N/SR/TB');
  }
  const effect = EFFECTS[plan.filter];
  if (effect) parts.push(effect);
  if (plan.loudnorm) parts.push(LOUDNORM);
  return parts.length > 0 ? parts.join(',') : null;
}

/** Posição no vídeo depois de `playedSec` segundos de áudio tocado, pulando os cortes e com a velocidade do filtro. */
export function mediaPosition(playedSec: number, plan: StreamPlan): number {
  let position = plan.startSec;
  let remaining = Math.max(0, playedSec) * FILTER_SPEED[plan.filter];
  for (const segment of plan.segments) {
    if (segment.end <= position) continue;
    if (segment.start <= position) {
      position = segment.end;
      continue;
    }
    const gap = segment.start - position;
    // Exatamente no início de um corte, o próximo áudio já é o do fim dele.
    if (remaining < gap) return position + remaining;
    remaining -= gap;
    position = segment.end;
  }
  return position + remaining;
}

/** Duração "útil": um corte que vai até o fim do vídeo termina a faixa mais cedo de propósito. */
export function effectiveDuration(durationSec: number, segments: readonly Segment[], toleranceSec: number): number {
  const last = segments[segments.length - 1];
  return last && last.end >= durationSec - toleranceSec ? Math.min(durationSec, last.start) : durationSec;
}
