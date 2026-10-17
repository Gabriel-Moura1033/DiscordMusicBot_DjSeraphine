export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/**
 * Migrações versionadas (`PRAGMA user_version`). Nunca editar uma migração já publicada:
 * mudança de schema = nova entrada no fim.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'schema inicial',
    sql: `
      CREATE TABLE guild_settings (
        guild_id   TEXT PRIMARY KEY,
        filter     TEXT NOT NULL,
        loop_mode  TEXT NOT NULL,
        autoplay   INTEGER NOT NULL,
        volume     INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Espelho da fila em memória; position 0 = faixa que estava tocando.
      CREATE TABLE queue_items (
        guild_id          TEXT NOT NULL,
        position          INTEGER NOT NULL,
        video_id          TEXT NOT NULL,
        title             TEXT NOT NULL,
        duration_sec      REAL,
        uploader          TEXT,
        requested_by_id   TEXT NOT NULL,
        requested_by_name TEXT NOT NULL,
        autoplay_from     TEXT,
        PRIMARY KEY (guild_id, position)
      );

      CREATE TABLE plays (
        id           INTEGER PRIMARY KEY,
        guild_id     TEXT NOT NULL,
        video_id     TEXT NOT NULL,
        title        TEXT NOT NULL,
        duration_sec REAL,
        uploader     TEXT,
        user_id      TEXT NOT NULL,
        user_name    TEXT NOT NULL,
        autoplay     INTEGER NOT NULL,
        played_at    INTEGER NOT NULL
      );
      CREATE INDEX plays_guild_time ON plays (guild_id, played_at);
      CREATE INDEX plays_guild_user_time ON plays (guild_id, user_id, played_at);

      CREATE TABLE playlists (
        id         INTEGER PRIMARY KEY,
        user_id    TEXT NOT NULL,
        name       TEXT NOT NULL COLLATE NOCASE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (user_id, name)
      );

      CREATE TABLE playlist_items (
        playlist_id  INTEGER NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
        position     INTEGER NOT NULL,
        video_id     TEXT NOT NULL,
        title        TEXT NOT NULL,
        duration_sec REAL,
        uploader     TEXT,
        PRIMARY KEY (playlist_id, position)
      );
    `,
  },
];
