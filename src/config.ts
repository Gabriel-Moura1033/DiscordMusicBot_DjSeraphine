import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { FILTER_NAMES, isFilterName, type FilterName } from './audio/filters.js';

dotenv.config({ quiet: true });

export interface Config {
  readonly discordToken: string;
  readonly clientId: string;
  readonly guildId: string;
  readonly maxPlaylistSize: number;
  readonly maxTrackDurationSec: number;
  readonly idleTimeoutMs: number;
  readonly defaultVolume: number;
  readonly historySize: number;
  readonly autoplayDefault: boolean;
  readonly autoplayRecentLimit: number;
  readonly loudnormEnabled: boolean;
  readonly preloadEnabled: boolean;
  readonly preloadSeconds: number;
  /** `null` = SponsorBlock desligado. */
  readonly sponsorblockApiUrl: string | null;
  readonly defaultFilter: FilterName;
  /** Arquivo SQLite; `:memory:` = sem persistência (`DB_PATH` definido e vazio). */
  readonly dbPath: string;
  readonly playlistsPerUser: number;
  /** `null` = painel desligado (`PANEL_ENABLED=false`). */
  readonly panel: PanelConfig | null;
  readonly ytdlpPath: string;
  readonly ffmpegPath: string;
  readonly logLevel: string;
  /** `null` = heartbeat desligado. */
  readonly heartbeatFile: string | null;
  /** 0 = nunca sai por gateway desconectado. */
  readonly gatewayDownExitMs: number;
  readonly autocompleteEnabled: boolean;
  readonly autocompleteCacheTtlMs: number;
  readonly presenceEnabled: boolean;
  readonly isProduction: boolean;
}

export interface PanelConfig {
  readonly host: string;
  readonly port: number;
  readonly token: string;
  readonly logBuffer: number;
  readonly announceActions: boolean;
}

/** Tamanho mínimo do PANEL_TOKEN: é a única barreira de acesso ao painel. */
const PANEL_TOKEN_MIN_LENGTH = 32;

class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ConfigError(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} deve ser um inteiro entre ${min} e ${max} (recebido: "${raw}")`);
  }
  return value;
}

function snowflake(name: string): string {
  const value = required(name);
  if (!/^\d{17,20}$/.test(value)) throw new ConfigError(`${name} não parece um ID do Discord válido`);
  return value;
}

function boolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new ConfigError(`${name} deve ser "true" ou "false" (recebido: "${raw}")`);
}

function httpsUrl(name: string, fallback: string): string {
  const value = optional(name, fallback).replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${name} não é uma URL válida (recebido: "${value}")`);
  }
  if (url.protocol !== 'https:') throw new ConfigError(`${name} deve usar https (recebido: "${value}")`);
  return value;
}

function filterName(name: string, fallback: FilterName): FilterName {
  const value = optional(name, fallback);
  if (!isFilterName(value)) throw new ConfigError(`${name} inválido: "${value}" (use ${FILTER_NAMES.join(', ')})`);
  return value;
}

/** Relativo ao diretório de trabalho (`/app` no container); definido e vazio = banco em memória. */
function databasePath(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined) return resolve(fallback);
  const value = raw.trim();
  return value === '' ? ':memory:' : resolve(value);
}

const PANEL_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '0.0.0.0', '::']);

function panelConfig(): PanelConfig | null {
  if (!boolean('PANEL_ENABLED', false)) return null;
  const host = optional('PANEL_HOST', '127.0.0.1');
  if (!PANEL_HOSTS.has(host)) {
    throw new ConfigError(`PANEL_HOST inválido: "${host}" (use 127.0.0.1, ou 0.0.0.0 só dentro do container)`);
  }
  const token = process.env['PANEL_TOKEN']?.trim() ?? '';
  if (token.length < PANEL_TOKEN_MIN_LENGTH) {
    throw new ConfigError(
      `PANEL_TOKEN é obrigatório com PANEL_ENABLED=true e precisa ter pelo menos ${PANEL_TOKEN_MIN_LENGTH} caracteres ` +
        '(gere com: openssl rand -hex 32)',
    );
  }
  return {
    host,
    port: integer('PANEL_PORT', 8787, 1024, 65_535),
    token,
    logBuffer: integer('PANEL_LOG_BUFFER', 1000, 100, 20_000),
    announceActions: boolean('PANEL_ANNOUNCE_ACTIONS', true),
  };
}

/** Diferente de `optional`: variável definida e vazia significa "desligado". */
function optionalPath(name: string, fallback: string): string | null {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = raw.trim();
  if (value === '') return null;
  if (!value.startsWith('/')) throw new ConfigError(`${name} deve ser um caminho absoluto (recebido: "${value}")`);
  return value;
}

const LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

function loadConfig(): Config {
  const logLevel = optional('LOG_LEVEL', 'info');
  if (!LOG_LEVELS.has(logLevel)) {
    throw new ConfigError(`LOG_LEVEL inválido: "${logLevel}" (use ${[...LOG_LEVELS].join(', ')})`);
  }

  return {
    discordToken: required('DISCORD_TOKEN'),
    clientId: snowflake('DISCORD_CLIENT_ID'),
    guildId: snowflake('DISCORD_GUILD_ID'),
    maxPlaylistSize: integer('MAX_PLAYLIST_SIZE', 100, 1, 1000),
    maxTrackDurationSec: integer('MAX_TRACK_DURATION_SECONDS', 7200, 1, 86_400),
    idleTimeoutMs: integer('IDLE_TIMEOUT_SECONDS', 300, 10, 86_400) * 1000,
    defaultVolume: integer('DEFAULT_VOLUME', 50, 0, 100),
    historySize: integer('HISTORY_SIZE', 20, 1, 100),
    autoplayDefault: boolean('AUTOPLAY_DEFAULT', false),
    autoplayRecentLimit: integer('AUTOPLAY_RECENT_LIMIT', 50, 5, 500),
    loudnormEnabled: boolean('LOUDNORM_ENABLED', true),
    preloadEnabled: boolean('PRELOAD_ENABLED', true),
    preloadSeconds: integer('PRELOAD_SECONDS', 20, 5, 120),
    sponsorblockApiUrl: boolean('SPONSORBLOCK_ENABLED', true)
      ? httpsUrl('SPONSORBLOCK_API_URL', 'https://sponsor.ajay.app')
      : null,
    defaultFilter: filterName('DEFAULT_FILTER', 'nenhum'),
    dbPath: databasePath('DB_PATH', 'data/dj.sqlite'),
    playlistsPerUser: integer('PLAYLISTS_PER_USER', 25, 1, 200),
    panel: panelConfig(),
    ytdlpPath: optional('YTDLP_PATH', 'yt-dlp'),
    ffmpegPath: optional('FFMPEG_PATH', 'ffmpeg'),
    logLevel,
    heartbeatFile: optionalPath('HEARTBEAT_FILE', '/tmp/dj-heartbeat'),
    gatewayDownExitMs: integer('GATEWAY_DOWN_EXIT_MINUTES', 5, 0, 1440) * 60_000,
    autocompleteEnabled: boolean('AUTOCOMPLETE_ENABLED', true),
    autocompleteCacheTtlMs: integer('AUTOCOMPLETE_CACHE_TTL_SECONDS', 600, 10, 86_400) * 1000,
    presenceEnabled: boolean('PRESENCE_ENABLED', true),
    isProduction: process.env['NODE_ENV'] === 'production',
  };
}

export const config: Config = (() => {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // Logger depende da config; erro de config vai direto para stderr.
      process.stderr.write(`[config] ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
})();
