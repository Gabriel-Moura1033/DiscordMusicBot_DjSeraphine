import { EmbedBuilder } from 'discord.js';
import type { LoopMode } from '../player/Queue.js';
import { truncate } from '../util/format.js';
import type { Track, TrackInfo } from '../youtube/YouTubeService.js';

export const EMBED_COLOR = 0xff0033;

export const LOOP_LABELS: Record<LoopMode, string> = {
  off: 'desligado',
  track: '🔂 faixa',
  queue: '🔁 fila',
};

/** "pedido por **X**", ou "Recomendado pela DJ Seraphine" (+ semente) nas faixas do autoplay. */
export function requesterLabel(track: Track, withSeed = true): string {
  if (track.autoplayFrom === undefined) return `pedido por **${track.requestedBy.name}**`;
  const seed = withSeed ? ` (a partir de "${truncate(track.autoplayFrom, 50)}")` : '';
  return `Recomendado pela ${track.requestedBy.name}${seed}`;
}

export function thumbnailUrl(track: TrackInfo): string {
  return `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`;
}

export function baseEmbed(): EmbedBuilder {
  return new EmbedBuilder().setColor(EMBED_COLOR);
}
