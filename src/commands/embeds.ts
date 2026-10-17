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

/** "pedido por" de uma faixa; as do autoplay dizem de qual faixa vieram. */
export function requesterLabel(track: Track): string {
  if (track.autoplayFrom === undefined) return track.requestedBy.name;
  return `${track.requestedBy.name} (a partir de "${truncate(track.autoplayFrom, 50)}")`;
}

export function thumbnailUrl(track: TrackInfo): string {
  return `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`;
}

export function baseEmbed(): EmbedBuilder {
  return new EmbedBuilder().setColor(EMBED_COLOR);
}
