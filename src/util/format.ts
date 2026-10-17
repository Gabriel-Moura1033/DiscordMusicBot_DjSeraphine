export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null) return '??:??';
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mmss = `${String(minutes).padStart(hours > 0 ? 2 : 1, '0')}:${String(seconds).padStart(2, '0')}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

export function progressBar(elapsedSec: number, totalSec: number | null, width = 18): string {
  if (totalSec === null || totalSec <= 0) return `🔘${'▬'.repeat(width)}`;
  const ratio = Math.min(1, Math.max(0, elapsedSec / totalSec));
  const position = Math.min(width - 1, Math.floor(ratio * width));
  return `${'▬'.repeat(position)}🔘${'▬'.repeat(width - position - 1)}`;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Evita que títulos de vídeo quebrem a formatação markdown do Discord. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|[\]()>#-])/g, '\\$1');
}

export function trackLink(track: { readonly title: string; readonly url: string }, max = 80): string {
  return `[${escapeMarkdown(truncate(track.title, max))}](${track.url})`;
}
