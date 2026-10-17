import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, type Migration } from './migrations.js';

export const IN_MEMORY = ':memory:';

export class MigrationError extends Error {
  override readonly name = 'MigrationError';
}

/** Executa `fn` numa transação; desfaz tudo se lançar. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get();
  const version = row?.['user_version'];
  return typeof version === 'number' ? version : 0;
}

/**
 * Aplica, em ordem, as migrações com versão maior que `PRAGMA user_version`; cada uma na sua
 * transação. Banco de versão mais nova que o código = erro (downgrade não suportado).
 */
export function migrate(db: DatabaseSync, migrations: readonly Migration[] = MIGRATIONS): { from: number; to: number } {
  const from = userVersion(db);
  const latest = migrations.reduce((max, migration) => Math.max(max, migration.version), 0);
  if (from > latest) {
    throw new MigrationError(`banco na versão ${from}, mas este código só conhece até a ${latest} (downgrade?)`);
  }
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (migration.version <= from) continue;
    try {
      transaction(db, () => {
        db.exec(migration.sql);
        // PRAGMA não aceita parâmetro; versão é número controlado pelo código.
        db.exec(`PRAGMA user_version = ${Math.trunc(migration.version)}`);
      });
    } catch (error) {
      throw new MigrationError(`migração ${migration.version} (${migration.name}) falhou: ${String(error)}`);
    }
  }
  return { from, to: userVersion(db) };
}

/** Abre (criando a pasta, se preciso), configura e migra. `:memory:` = sem persistência. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== IN_MEMORY) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (path !== IN_MEMORY) {
    // WAL: escrita não bloqueia leitura e sobrevive melhor a um kill no meio da gravação.
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  migrate(db);
  return db;
}
