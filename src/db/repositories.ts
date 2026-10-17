import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { isFilterName } from '../audio/filters.js';
import type { GuildSettings } from '../player/GuildSettings.js';
import type { LoopMode } from '../player/Queue.js';
import { videoUrl } from '../youtube/url.js';
import type { Track, TrackInfo } from '../youtube/YouTubeService.js';
import { transaction } from './database.js';

type Row = Record<string, SQLOutputValue>;

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`coluna ${key}: esperado texto, veio ${typeof value}`);
  return value;
}

function textOrNull(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function numberOrNull(row: Row, key: string): number | null {
  const value = row[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return null;
}

function integer(row: Row, key: string): number {
  const value = numberOrNull(row, key);
  if (value === null) throw new Error(`coluna ${key}: esperado número`);
  return value;
}

function trackInfo(row: Row): TrackInfo {
  const id = text(row, 'video_id');
  return {
    id,
    url: videoUrl(id),
    title: text(row, 'title'),
    durationSec: numberOrNull(row, 'duration_sec'),
    uploader: textOrNull(row, 'uploader'),
  };
}

function isLoopMode(value: string): value is LoopMode {
  return value === 'off' || value === 'track' || value === 'queue';
}

export class SettingsRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** `null` = nada salvo. Valores inválidos (ex.: filtro removido do código) voltam ao padrão. */
  load(guildId: string, defaults: GuildSettings): GuildSettings | null {
    const row = this.db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
    if (!row) return null;
    const filter = text(row, 'filter');
    const loopMode = text(row, 'loop_mode');
    const volume = integer(row, 'volume');
    return {
      filter: isFilterName(filter) ? filter : defaults.filter,
      loopMode: isLoopMode(loopMode) ? loopMode : defaults.loopMode,
      autoplay: integer(row, 'autoplay') === 1,
      volume: volume >= 0 && volume <= 100 ? volume : defaults.volume,
    };
  }

  save(guildId: string, settings: GuildSettings, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO guild_settings (guild_id, filter, loop_mode, autoplay, volume, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (guild_id) DO UPDATE SET
           filter = excluded.filter, loop_mode = excluded.loop_mode, autoplay = excluded.autoplay,
           volume = excluded.volume, updated_at = excluded.updated_at`,
      )
      .run(guildId, settings.filter, settings.loopMode, settings.autoplay ? 1 : 0, settings.volume, now);
  }
}

export class QueueRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** Faixas na ordem (a que tocava primeiro). */
  load(guildId: string): Track[] {
    return this.db
      .prepare('SELECT * FROM queue_items WHERE guild_id = ? ORDER BY position')
      .all(guildId)
      .map((row) => {
        const autoplayFrom = textOrNull(row, 'autoplay_from');
        return {
          ...trackInfo(row),
          requestedBy: { id: text(row, 'requested_by_id'), name: text(row, 'requested_by_name') },
          ...(autoplayFrom !== null ? { autoplayFrom } : {}),
        };
      });
  }

  /** Substitui o espelho inteiro (lista vazia = apaga). */
  save(guildId: string, tracks: readonly Track[]): void {
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM queue_items WHERE guild_id = ?').run(guildId);
      const insert = this.db.prepare(
        `INSERT INTO queue_items
           (guild_id, position, video_id, title, duration_sec, uploader, requested_by_id, requested_by_name, autoplay_from)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      tracks.forEach((track, position) => {
        insert.run(
          guildId,
          position,
          track.id,
          track.title,
          track.durationSec,
          track.uploader,
          track.requestedBy.id,
          track.requestedBy.name,
          track.autoplayFrom ?? null,
        );
      });
    });
  }
}

export type TopScope = { readonly kind: 'guild' } | { readonly kind: 'user'; readonly userId: string };

export interface TopEntry {
  readonly track: TrackInfo;
  readonly plays: number;
}

export class PlaysRepository {
  constructor(private readonly db: DatabaseSync) {}

  record(guildId: string, track: Track, playedAt = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO plays (guild_id, video_id, title, duration_sec, uploader, user_id, user_name, autoplay, played_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        guildId,
        track.id,
        track.title,
        track.durationSec,
        track.uploader,
        track.requestedBy.id,
        track.requestedBy.name,
        track.autoplayFrom !== undefined ? 1 : 0,
        playedAt,
      );
  }

  /**
   * Mais tocadas desde `since` (ms; 0 = sempre). Faixas do autoplay não contam: o ranking mostra o
   * que as pessoas pediram. Empate: a tocada mais recentemente primeiro.
   */
  top(guildId: string, scope: TopScope, since: number, limit: number): TopEntry[] {
    const byUser = scope.kind === 'user';
    const rows = this.db
      .prepare(
        `SELECT video_id, COUNT(*) AS plays, MAX(played_at) AS last_played,
                (SELECT p2.title FROM plays p2 WHERE p2.video_id = plays.video_id ORDER BY p2.played_at DESC LIMIT 1) AS title,
                MAX(duration_sec) AS duration_sec, MAX(uploader) AS uploader
           FROM plays
          WHERE guild_id = ? AND autoplay = 0 AND played_at >= ? ${byUser ? 'AND user_id = ?' : ''}
          GROUP BY video_id
          ORDER BY plays DESC, last_played DESC
          LIMIT ?`,
      )
      .all(...(byUser ? [guildId, since, scope.userId, limit] : [guildId, since, limit]));
    return rows.map((row) => ({ track: trackInfo(row), plays: integer(row, 'plays') }));
  }

  /** Últimas reproduções da guild (mais recente primeiro), para recriar o histórico do /previous. */
  recent(guildId: string, limit: number): Track[] {
    return this.db
      .prepare('SELECT * FROM plays WHERE guild_id = ? ORDER BY played_at DESC, id DESC LIMIT ?')
      .all(guildId, limit)
      .map((row) => ({
        ...trackInfo(row),
        requestedBy: { id: text(row, 'user_id'), name: text(row, 'user_name') },
        // A semente não é guardada em plays; '' mantém a marca de autoplay sem o "a partir de".
        ...(integer(row, 'autoplay') === 1 ? { autoplayFrom: '' } : {}),
      }));
  }
}

export interface PlaylistSummary {
  readonly name: string;
  readonly count: number;
  readonly durationSec: number;
  readonly updatedAt: number;
}

export type SavePlaylistResult = 'created' | 'replaced' | 'limit';

export class PlaylistRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly maxPerUser: number,
  ) {}

  list(userId: string): PlaylistSummary[] {
    return this.db
      .prepare(
        `SELECT p.name, p.updated_at, COUNT(i.position) AS count, COALESCE(SUM(i.duration_sec), 0) AS duration
           FROM playlists p LEFT JOIN playlist_items i ON i.playlist_id = p.id
          WHERE p.user_id = ?
          GROUP BY p.id
          ORDER BY p.name COLLATE NOCASE`,
      )
      .all(userId)
      .map((row) => ({
        name: text(row, 'name'),
        count: integer(row, 'count'),
        durationSec: integer(row, 'duration'),
        updatedAt: integer(row, 'updated_at'),
      }));
  }

  /** Nomes para o autocomplete: começam com `prefix` primeiro, depois os que o contêm. */
  names(userId: string, prefix: string, limit: number): string[] {
    const needle = prefix.trim().toLowerCase();
    return this.list(userId)
      .map((playlist) => playlist.name)
      .filter((name) => name.toLowerCase().includes(needle))
      .sort((a, b) => Number(!a.toLowerCase().startsWith(needle)) - Number(!b.toLowerCase().startsWith(needle)))
      .slice(0, limit);
  }

  get(userId: string, name: string): { readonly name: string; readonly tracks: TrackInfo[] } | null {
    const playlist = this.db.prepare('SELECT id, name FROM playlists WHERE user_id = ? AND name = ?').get(userId, name);
    if (!playlist) return null;
    const tracks = this.db
      .prepare('SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position')
      .all(integer(playlist, 'id'))
      .map(trackInfo);
    return { name: text(playlist, 'name'), tracks };
  }

  /** Cria ou substitui (mesmo nome, sem diferenciar maiúsculas). `limit` = usuário já tem o máximo. */
  save(userId: string, name: string, tracks: readonly TrackInfo[], now = Date.now()): SavePlaylistResult {
    return transaction(this.db, () => {
      const existing = this.db.prepare('SELECT id FROM playlists WHERE user_id = ? AND name = ?').get(userId, name);
      let playlistId: number;
      if (existing) {
        playlistId = integer(existing, 'id');
        // Guarda a grafia nova do nome também.
        this.db.prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?').run(name, now, playlistId);
        this.db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(playlistId);
      } else {
        const count = this.db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE user_id = ?').get(userId);
        if (count && integer(count, 'n') >= this.maxPerUser) return 'limit';
        const result = this.db
          .prepare('INSERT INTO playlists (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
          .run(userId, name, now, now);
        playlistId = Number(result.lastInsertRowid);
      }
      const insert = this.db.prepare(
        'INSERT INTO playlist_items (playlist_id, position, video_id, title, duration_sec, uploader) VALUES (?, ?, ?, ?, ?, ?)',
      );
      tracks.forEach((track, position) => {
        insert.run(playlistId, position, track.id, track.title, track.durationSec, track.uploader);
      });
      return existing ? 'replaced' : 'created';
    });
  }

  delete(userId: string, name: string): boolean {
    const result = this.db.prepare('DELETE FROM playlists WHERE user_id = ? AND name = ?').run(userId, name);
    return Number(result.changes) > 0;
  }
}

/** Todos os repositórios sobre a mesma conexão. */
export class Store {
  readonly settings: SettingsRepository;
  readonly queues: QueueRepository;
  readonly plays: PlaysRepository;
  readonly playlists: PlaylistRepository;

  constructor(
    readonly db: DatabaseSync,
    options: { readonly playlistsPerUser: number },
  ) {
    this.settings = new SettingsRepository(db);
    this.queues = new QueueRepository(db);
    this.plays = new PlaysRepository(db);
    this.playlists = new PlaylistRepository(db, options.playlistsPerUser);
  }
}
