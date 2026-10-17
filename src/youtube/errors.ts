export type YtErrorCode =
  | 'private'
  | 'unavailable'
  | 'age_restricted'
  | 'geo_blocked'
  | 'bot_check'
  | 'live'
  | 'too_long'
  | 'not_found'
  | 'extractor'
  | 'timeout'
  | 'unknown';

const DEFAULT_MESSAGES: Record<YtErrorCode, string> = {
  private: 'o vídeo é privado ou exclusivo para membros',
  unavailable: 'o vídeo está indisponível ou foi removido',
  age_restricted: 'o vídeo tem restrição de idade',
  geo_blocked: 'o vídeo está bloqueado na região do servidor',
  bot_check: 'o YouTube bloqueou o acesso a partir deste servidor (verificação anti-bot)',
  live: 'transmissões ao vivo e estreias não são suportadas',
  too_long: 'o vídeo é mais longo que o limite permitido',
  not_found: 'nenhum resultado encontrado',
  extractor: 'o yt-dlp não conseguiu extrair o áudio (pode estar desatualizado; reiniciar o bot força a atualização)',
  timeout: 'o YouTube demorou demais para responder',
  unknown: 'erro inesperado ao acessar o YouTube',
};

export class YtError extends Error {
  override readonly name = 'YtError';

  constructor(
    readonly code: YtErrorCode,
    /** Mensagem em português, pronta para mostrar ao usuário. */
    readonly userMessage: string = DEFAULT_MESSAGES[code],
    readonly stderr?: string,
  ) {
    super(`${code}: ${userMessage}`);
  }
}

// A ordem importa: "Sign in to confirm your age" precisa casar antes do bot-check genérico.
const PATTERNS: ReadonlyArray<readonly [YtErrorCode, RegExp]> = [
  ['private', /Private video|members[- ]only|Join this channel to get access/i],
  ['age_restricted', /confirm your age|age[- ]restricted|inappropriate for some users/i],
  ['bot_check', /not a bot|HTTP Error 429|Too Many Requests/i],
  ['geo_blocked', /not available in your country|blocked it in your country|geo[- ]?restrict/i],
  ['live', /live event will begin|Premieres in|is_upcoming/i],
  [
    'unavailable',
    /Video unavailable|This video is unavailable|has been removed|account associated with this video has been terminated|does not exist|Incomplete YouTube ID/i,
  ],
  ['extractor', /Requested format is not available|nsig|Signature extraction failed|Unable to extract|HTTP Error 403/i],
];

export function classifyStderr(stderr: string): YtErrorCode {
  for (const [code, pattern] of PATTERNS) {
    if (pattern.test(stderr)) return code;
  }
  return 'unknown';
}

export function ytErrorFromStderr(stderr: string): YtError {
  return new YtError(classifyStderr(stderr), undefined, stderr);
}

/** O yt-dlp sai com código 0 e sem dados quando o `--match-filter` rejeita o vídeo. */
export function isFilterRejection(stderr: string): boolean {
  return stderr.includes('does not pass filter');
}
