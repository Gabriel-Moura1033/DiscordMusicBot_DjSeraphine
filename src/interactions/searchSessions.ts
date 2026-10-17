/** Resultados de /search aguardando escolha. Cada sessão expira sozinha e é consumida na primeira escolha. */

interface Session<T> {
  readonly ownerId: string;
  readonly results: readonly T[];
  readonly timer: NodeJS.Timeout;
}

export class SearchSessions<T> {
  private readonly sessions = new Map<string, Session<T>>();

  constructor(private readonly ttlMs: number) {}

  get size(): number {
    return this.sessions.size;
  }

  create(key: string, ownerId: string, results: readonly T[], onExpire: () => void): void {
    this.drop(key);
    const timer = setTimeout(() => {
      this.sessions.delete(key);
      onExpire();
    }, this.ttlMs);
    timer.unref();
    this.sessions.set(key, { ownerId, results, timer });
  }

  /** Dono da sessão; `null` = expirou ou já foi usada. */
  owner(key: string): string | null {
    return this.sessions.get(key)?.ownerId ?? null;
  }

  /** Consome a sessão (a escolha só vale uma vez). */
  take(key: string): readonly T[] | null {
    const session = this.sessions.get(key);
    if (!session) return null;
    this.drop(key);
    return session.results;
  }

  clear(): void {
    for (const key of [...this.sessions.keys()]) this.drop(key);
  }

  private drop(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;
    clearTimeout(session.timer);
    this.sessions.delete(key);
  }
}
