import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { normalizePlaylistName } from '../src/commands/playlist.js';
import { periodStart } from '../src/commands/top.js';
import { IN_MEMORY, migrate, MigrationError, openDatabase, transaction } from '../src/db/database.js';
import { MIGRATIONS } from '../src/db/migrations.js';
import { Store } from '../src/db/repositories.js';
import type { GuildSettings } from '../src/player/GuildSettings.js';
import type { Track, TrackInfo } from '../src/youtube/YouTubeService.js';

const GUILD = '111111111111111111';
const OTHER_GUILD = '222222222222222222';
const ALICE = '333333333333333333';
const BOB = '444444444444444444';
const BOT = '999999999999999999';
const DAY = 86_400_000;

function info(id: string, durationSec: number | null = 200): TrackInfo {
  return { id, url: `https://www.youtube.com/watch?v=${id}`, title: `Faixa ${id}`, durationSec, uploader: `Canal ${id}` };
}

function track(id: string, by = ALICE, autoplayFrom?: string): Track {
  return {
    ...info(id),
    requestedBy: { id: by, name: by === ALICE ? 'Alice' : by === BOB ? 'Bob' : 'DJ Seraphine' },
    ...(autoplayFrom !== undefined ? { autoplayFrom } : {}),
  };
}

const id = (n: number): string => `vid${String(n).padStart(8, '0')}`;

function store(playlistsPerUser = 3): Store {
  return new Store(openDatabase(IN_MEMORY), { playlistsPerUser });
}

describe('migrações', () => {
  it('banco novo vai até a última versão e cria as tabelas', () => {
    const db = new DatabaseSync(IN_MEMORY);
    const latest = Math.max(...MIGRATIONS.map((m) => m.version));
    expect(migrate(db)).toEqual({ from: 0, to: latest });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row['name']);
    expect(tables).toEqual(['guild_settings', 'playlist_items', 'playlists', 'plays', 'queue_items']);
  });

  it('reaplicar não faz nada', () => {
    const db = new DatabaseSync(IN_MEMORY);
    migrate(db);
    const latest = Math.max(...MIGRATIONS.map((m) => m.version));
    expect(migrate(db)).toEqual({ from: latest, to: latest });
  });

  it('aplica só as novas, em ordem, e registra a versão', () => {
    const db = new DatabaseSync(IN_MEMORY);
    migrate(db, [{ version: 1, name: 'a', sql: 'CREATE TABLE a (x)' }]);
    const result = migrate(db, [
      { version: 3, name: 'c', sql: 'ALTER TABLE a ADD COLUMN z' },
      { version: 1, name: 'a', sql: 'CREATE TABLE a (x)' },
      { version: 2, name: 'b', sql: 'ALTER TABLE a ADD COLUMN y' },
    ]);
    expect(result).toEqual({ from: 1, to: 3 });
    expect(db.prepare('SELECT x, y, z FROM a').all()).toEqual([]);
  });

  it('migração com erro desfaz tudo e não avança a versão', () => {
    const db = new DatabaseSync(IN_MEMORY);
    expect(() => migrate(db, [{ version: 1, name: 'quebrada', sql: 'CREATE TABLE ok (x); CREATE TABLEE ruim' }])).toThrow(
      MigrationError,
    );
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ok'").get()).toBeUndefined();
  });

  it('banco mais novo que o código = erro (sem downgrade)', () => {
    const db = new DatabaseSync(IN_MEMORY);
    db.exec('PRAGMA user_version = 99');
    expect(() => migrate(db)).toThrow(/downgrade/);
  });

  it('transaction desfaz em erro', () => {
    const db = new DatabaseSync(IN_MEMORY);
    db.exec('CREATE TABLE t (x)');
    expect(() =>
      transaction(db, () => {
        db.prepare('INSERT INTO t VALUES (1)').run();
        throw new Error('falhou');
      }),
    ).toThrow('falhou');
    expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 0 });
  });
});

describe('SettingsRepository', () => {
  const defaults: GuildSettings = { filter: 'nenhum', loopMode: 'off', autoplay: false, volume: 50 };

  it('nada salvo = null; salva, lê e atualiza', () => {
    const s = store();
    expect(s.settings.load(GUILD, defaults)).toBeNull();
    s.settings.save(GUILD, { filter: 'nightcore', loopMode: 'queue', autoplay: true, volume: 80 });
    expect(s.settings.load(GUILD, defaults)).toEqual({ filter: 'nightcore', loopMode: 'queue', autoplay: true, volume: 80 });
    s.settings.save(GUILD, { filter: '8d', loopMode: 'off', autoplay: false, volume: 10 });
    expect(s.settings.load(GUILD, defaults)).toEqual({ filter: '8d', loopMode: 'off', autoplay: false, volume: 10 });
    expect(s.settings.load(OTHER_GUILD, defaults)).toBeNull();
  });

  it('valores que o código não conhece mais voltam ao padrão', () => {
    const s = store();
    s.db
      .prepare('INSERT INTO guild_settings VALUES (?, ?, ?, ?, ?, ?)')
      .run(GUILD, 'reverb', 'shuffle', 1, 500, 0);
    expect(s.settings.load(GUILD, defaults)).toEqual({ filter: 'nenhum', loopMode: 'off', autoplay: true, volume: 50 });
  });
});

describe('QueueRepository', () => {
  it('ida e volta preserva ordem, pedido, autoplay e duração nula', () => {
    const s = store();
    const queue = [track(id(1)), { ...track(id(2), BOB), durationSec: null, uploader: null }, track(id(3), BOT, 'Semente')];
    s.queues.save(GUILD, queue);
    expect(s.queues.load(GUILD)).toEqual(queue);
    expect(s.queues.load(OTHER_GUILD)).toEqual([]);
  });

  it('salvar substitui; lista vazia apaga', () => {
    const s = store();
    s.queues.save(GUILD, [track(id(1)), track(id(2))]);
    s.queues.save(GUILD, [track(id(3))]);
    expect(s.queues.load(GUILD).map((t) => t.id)).toEqual([id(3)]);
    s.queues.save(GUILD, []);
    expect(s.queues.load(GUILD)).toEqual([]);
  });
});

describe('PlaysRepository', () => {
  const now = 100 * DAY;

  function seeded() {
    const s = store();
    const play = (videoId: string, by: string, daysAgo: number, autoplay = false) =>
      s.plays.record(GUILD, autoplay ? track(videoId, BOT, 'x') : track(videoId, by), now - daysAgo * DAY);
    // A: 3× (Alice 2, Bob 1); B: 2× Bob; C: 4× há 40 dias; D: 5× autoplay; E: outra guild.
    play(id(1), ALICE, 1);
    play(id(1), ALICE, 2);
    play(id(1), BOB, 3);
    play(id(2), BOB, 1);
    play(id(2), BOB, 0.5);
    for (let i = 0; i < 4; i++) play(id(3), ALICE, 40);
    for (let i = 0; i < 5; i++) play(id(4), ALICE, 1, true);
    s.plays.record(OTHER_GUILD, track(id(5)), now);
    return s;
  }

  const ids = (entries: { track: TrackInfo; plays: number }[]) => entries.map((e) => [e.track.id, e.plays]);

  it('servidor, 30 dias: conta pedidos, ignora autoplay e outras guilds', () => {
    expect(ids(seeded().plays.top(GUILD, { kind: 'guild' }, periodStart('30d', now), 10))).toEqual([
      [id(1), 3],
      [id(2), 2],
    ]);
  });

  it('servidor, sempre: inclui as antigas', () => {
    expect(ids(seeded().plays.top(GUILD, { kind: 'guild' }, periodStart('sempre', now), 10))).toEqual([
      [id(3), 4],
      [id(1), 3],
      [id(2), 2],
    ]);
  });

  it('eu: só o que a pessoa pediu', () => {
    const s = seeded();
    expect(ids(s.plays.top(GUILD, { kind: 'user', userId: BOB }, periodStart('7d', now), 10))).toEqual([
      [id(2), 2],
      [id(1), 1],
    ]);
    expect(ids(s.plays.top(GUILD, { kind: 'user', userId: ALICE }, periodStart('7d', now), 10))).toEqual([[id(1), 2]]);
  });

  it('respeita o limite e devolve a faixa completa', () => {
    const [first] = seeded().plays.top(GUILD, { kind: 'guild' }, 0, 1);
    expect(first).toEqual({ track: info(id(3)), plays: 4 });
  });

  it('recent: mais recente primeiro (empate: inserida por último), com quem pediu e marca de autoplay', () => {
    const recent = seeded().plays.recent(GUILD, 3);
    expect(recent.map((t) => t.id)).toEqual([id(2), id(4), id(4)]);
    expect(recent[0]?.requestedBy).toEqual({ id: BOB, name: 'Bob' });
    expect(recent[0]?.autoplayFrom).toBeUndefined();
    expect(recent[1]?.autoplayFrom).toBe('');
  });
});

describe('PlaylistRepository', () => {
  it('salva, lista, carrega e apaga', () => {
    const s = store();
    expect(s.playlists.save(ALICE, 'Rock', [info(id(1), 100), info(id(2), 200)], 1)).toBe('created');
    expect(s.playlists.list(ALICE)).toEqual([{ name: 'Rock', count: 2, durationSec: 300, updatedAt: 1 }]);
    expect(s.playlists.get(ALICE, 'Rock')).toEqual({ name: 'Rock', tracks: [info(id(1), 100), info(id(2), 200)] });
    expect(s.playlists.delete(ALICE, 'Rock')).toBe(true);
    expect(s.playlists.delete(ALICE, 'Rock')).toBe(false);
    expect(s.playlists.get(ALICE, 'Rock')).toBeNull();
    // ON DELETE CASCADE: nada órfão.
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM playlist_items').get()).toEqual({ n: 0 });
  });

  it('nomes não diferenciam maiúsculas; salvar de novo substitui e guarda a grafia nova', () => {
    const s = store();
    s.playlists.save(ALICE, 'rock', [info(id(1))]);
    expect(s.playlists.save(ALICE, 'ROCK', [info(id(2)), info(id(3))])).toBe('replaced');
    expect(s.playlists.get(ALICE, 'Rock')).toEqual({ name: 'ROCK', tracks: [info(id(2)), info(id(3))] });
    expect(s.playlists.list(ALICE)).toHaveLength(1);
  });

  it('playlists são por usuário', () => {
    const s = store();
    s.playlists.save(ALICE, 'Rock', [info(id(1))]);
    expect(s.playlists.get(BOB, 'Rock')).toBeNull();
    expect(s.playlists.delete(BOB, 'Rock')).toBe(false);
    expect(s.playlists.list(BOB)).toEqual([]);
  });

  it('limite por usuário vale para criar, não para substituir', () => {
    const s = store(2);
    s.playlists.save(ALICE, 'a', [info(id(1))]);
    s.playlists.save(ALICE, 'b', [info(id(1))]);
    expect(s.playlists.save(ALICE, 'c', [info(id(1))])).toBe('limit');
    expect(s.playlists.save(ALICE, 'B', [info(id(2))])).toBe('replaced');
    expect(s.playlists.save(BOB, 'c', [info(id(1))])).toBe('created');
  });

  it('autocomplete: prefixo primeiro, depois quem contém; respeita o limite', () => {
    const s = store(10);
    for (const name of ['Samba de raiz', 'Rock nacional', 'Rock 80', 'Pagode e samba']) s.playlists.save(ALICE, name, [info(id(1))]);
    expect(s.playlists.names(ALICE, 'sam', 10)).toEqual(['Samba de raiz', 'Pagode e samba']);
    expect(s.playlists.names(ALICE, 'rock', 1)).toEqual(['Rock 80']);
    expect(s.playlists.names(ALICE, '', 10)).toHaveLength(4);
  });
});

describe('normalizePlaylistName', () => {
  it.each([
    ['  Rock   nacional ', 'Rock nacional'],
    ['a', 'a'],
    ['x'.repeat(50), 'x'.repeat(50)],
  ])('%j → %j', (raw, expected) => {
    expect(normalizePlaylistName(raw)).toBe(expected);
  });

  it.each(['', '   ', 'x'.repeat(51), 'com\u0000nulo', 'com\u0007bell'])('rejeita %j', (raw) => {
    expect(normalizePlaylistName(raw)).toBeNull();
  });
});

describe('periodStart', () => {
  it('7d, 30d e sempre', () => {
    expect(periodStart('7d', 100 * DAY)).toBe(93 * DAY);
    expect(periodStart('30d', 100 * DAY)).toBe(70 * DAY);
    expect(periodStart('sempre', 100 * DAY)).toBe(0);
  });
});
