import { EmbedBuilder } from 'discord.js';
import type { LoopMode } from '../player/Queue.js';
import type { TrackInfo } from '../youtube/YouTubeService.js';

export const EMBED_COLOR = 0xff0033;

export const LOOP_LABELS: Record<LoopMode, string> = {
  off: 'desligado',
  track: '🔂 faixa',
  queue: '🔁 fila',
};

export function thumbnailUrl(track: TrackInfo): string {
  return `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`;
}

export function baseEmbed(): EmbedBuilder {
  return new EmbedBuilder().setColor(EMBED_COLOR);
}
