/**
 * Autenticação e proteções do painel (ADR-046): login por token, sessão em cookie HttpOnly +
 * SameSite=Strict, CSRF por sessão, checagem de Host/Origin (só localhost / 127.0.0.1 na porta do
 * painel) e rate limit. Tudo puro, com relógio injetável.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'dj_session';
export const SESSION_TTL_MS = 12 * 3_600_000;
export const CSRF_HEADER = 'x-csrf-token';

/** Comparação em tempo constante (os hashes têm sempre o mesmo tamanho). */
export function safeEqual(a: string, b: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface Session {
  readonly id: string;
  readonly csrf: string;
  readonly expiresAt: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly ttlMs = SESSION_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  create(): Session {
    this.prune();
    const session = { id: randomToken(), csrf: randomToken(), expiresAt: this.now() + this.ttlMs };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string | null): Session | null {
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  destroy(id: string | null): void {
    if (id) this.sessions.delete(id);
  }

  private prune(): void {
    const now = this.now();
    for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(id);
  }
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return cookies;
}

/** Sem `Secure`: o painel é HTTP em localhost. */
export function sessionCookie(session: Session, ttlMs = SESSION_TTL_MS): string {
  return `${SESSION_COOKIE}=${session.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(ttlMs / 1000)}`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

/** Hosts aceitos: o painel só existe em localhost (bloqueia DNS rebinding). */
export function allowedHosts(port: number): ReadonlySet<string> {
  return new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
}

export function allowedOrigins(port: number): ReadonlySet<string> {
  return new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
}

export type GuardFailure = { readonly status: 400 | 401 | 403 | 429; readonly error: string; readonly retryAfterSec?: number };

export interface RequestFacts {
  readonly method: string;
  readonly host: string | undefined;
  readonly origin: string | undefined;
  readonly csrf: string | undefined;
}

export function checkHost(facts: RequestFacts, port: number): GuardFailure | null {
  return facts.host && allowedHosts(port).has(facts.host.toLowerCase())
    ? null
    : { status: 403, error: 'Host não permitido.' };
}

/** Origin de localhost ou 127.0.0.1 na porta do painel (POST de outro site é recusado). */
export function checkOrigin(facts: RequestFacts, port: number): GuardFailure | null {
  return facts.origin && allowedOrigins(port).has(facts.origin.toLowerCase())
    ? null
    : { status: 403, error: 'Origem não permitida.' };
}

/** Rotas que alteram estado: Origin permitido + token CSRF da sessão. */
export function checkCsrf(facts: RequestFacts, session: Session, port: number): GuardFailure | null {
  const origin = checkOrigin(facts, port);
  if (origin) return origin;
  if (!facts.csrf || !safeEqual(facts.csrf, session.csrf)) return { status: 403, error: 'Token CSRF inválido. Recarregue a página.' };
  return null;
}

/** Janela fixa por chave (ex.: "msg:<sessão>"); suficiente para um painel de um usuário. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** `null` = liberado; senão, segundos até liberar. */
  take(key: string): number | null {
    const now = this.now();
    const window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return null;
    }
    if (window.count >= this.limit) return Math.max(1, Math.ceil((window.start + this.windowMs - now) / 1000));
    window.count++;
    return null;
  }
}

export const RATE_LIMITS = {
  /** Tentativas de login por IP. */
  login: { limit: 5, windowMs: 60_000 },
  /** Mensagens enviadas pelo painel por sessão. */
  message: { limit: 5, windowMs: 60_000 },
  /** Ações de controle por sessão. */
  control: { limit: 60, windowMs: 60_000 },
} as const;
