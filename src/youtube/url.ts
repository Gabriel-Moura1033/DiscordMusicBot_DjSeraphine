export type ParsedInput =
  | { readonly kind: 'video'; readonly videoId: string; readonly url: string }
  | { readonly kind: 'playlist'; readonly playlistId: string; readonly url: string }
  | { readonly kind: 'search'; readonly query: string }
  | { readonly kind: 'rejected'; readonly reason: string };

export type ResolvableInput = Exclude<ParsedInput, { kind: 'rejected' }>;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{2,64}$/;
const MAX_QUERY_LENGTH = 200;

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);

// Caminhos que carregam o ID do vídeo como primeiro segmento: /shorts/ID, /live/ID, /embed/ID, /v/ID.
const ID_PATH_PREFIXES = new Set(['shorts', 'live', 'embed', 'v']);

export function videoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function playlistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${playlistId}`;
}

function video(videoId: string | null | undefined): ParsedInput | null {
  return videoId && VIDEO_ID.test(videoId) ? { kind: 'video', videoId, url: videoUrl(videoId) } : null;
}

function playlist(playlistId: string | null | undefined): ParsedInput | null {
  return playlistId && PLAYLIST_ID.test(playlistId)
    ? { kind: 'playlist', playlistId, url: playlistUrl(playlistId) }
    : null;
}

/** Aceita "https://...", "http://..." e também "youtu.be/..." / "www.youtube.com/..." sem esquema. */
function tryParseUrl(raw: string): URL | null {
  if (/\s/.test(raw)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : /^[\w-]+(\.[\w-]+)+\//.test(raw) ? `https://${raw}` : null;
  if (!candidate) return null;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

function parseYouTubeUrl(url: URL): ParsedInput | null {
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  if (SHORT_HOSTS.has(host)) return video(segments[0]);
  if (!YOUTUBE_HOSTS.has(host)) return null;

  const [first, second] = segments;
  if (first === 'watch') {
    // watch?v=X&list=Y toca só o vídeo; watch?list=Y (sem v) é tratado como playlist.
    return video(url.searchParams.get('v')) ?? playlist(url.searchParams.get('list'));
  }
  if (first === 'playlist') return playlist(url.searchParams.get('list'));
  if (first && ID_PATH_PREFIXES.has(first)) return video(second);
  return null;
}

export function parseInput(raw: string): ParsedInput {
  const input = raw.trim();
  if (!input) return { kind: 'rejected', reason: 'Informe um link do YouTube ou o nome da música.' };

  const url = tryParseUrl(input);
  if (!url) {
    if (input.length > MAX_QUERY_LENGTH) {
      return { kind: 'rejected', reason: `A busca pode ter no máximo ${MAX_QUERY_LENGTH} caracteres.` };
    }
    return { kind: 'search', query: input };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { kind: 'rejected', reason: 'Só aceito links http(s) do YouTube.' };
  }

  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host) && !SHORT_HOSTS.has(host)) {
    return {
      kind: 'rejected',
      reason: `Só toco do YouTube. Links de \`${host}\` não são suportados — tente buscar pelo nome da música.`,
    };
  }

  return (
    parseYouTubeUrl(url) ?? {
      kind: 'rejected',
      reason: 'Não reconheci esse link do YouTube. Use um link de vídeo, shorts ou playlist.',
    }
  );
}
