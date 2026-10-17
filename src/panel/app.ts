/**
 * Rotas do painel, independentes do node:http: recebem um `PanelRequest` e devolvem a resposta
 * (ou um stream SSE). O adaptador em `server.ts` só faz o transporte.
 */
import type { Guild } from 'discord.js';
import type { ControlResult } from '../control/types.js';
import type { LogEntry } from '../logging.js';
import type { ChannelView, SendResult } from './discord.js';
import {
  checkCsrf,
  checkHost,
  checkOrigin,
  clearedCookie,
  CSRF_HEADER,
  parseCookies,
  RateLimiter,
  safeEqual,
  SESSION_COOKIE,
  sessionCookie,
  type GuardFailure,
  type RequestFacts,
  type Session,
  type SessionStore,
} from './security.js';
import type { PanelSnapshot } from './state.js';
import { isSnowflake, validateAction, validateMessage, type PanelAction, type SendMessageInput } from './validation.js';

export interface PanelRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
  readonly remoteAddress: string;
}

export interface SseStream {
  send(event: string, data: unknown): void;
  comment(text: string): void;
  close(): void;
}

export type PanelResponse =
  | { readonly kind: 'body'; readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: string }
  | { readonly kind: 'sse'; readonly headers: Readonly<Record<string, string>>; open(stream: SseStream): () => void };

export interface PanelAssets {
  readonly html: string;
  readonly css: string;
  readonly js: string;
}

export interface PanelAppDeps {
  readonly port: number;
  readonly token: string;
  readonly sessions: SessionStore;
  readonly limiters: { readonly login: RateLimiter; readonly message: RateLimiter; readonly control: RateLimiter };
  readonly assets: PanelAssets;
  readonly state: { current(): PanelSnapshot; subscribe(listener: (snapshot: PanelSnapshot) => void): () => void; poke(): void };
  readonly logs: { entries(): readonly LogEntry[]; subscribe(listener: (entry: LogEntry) => void): () => void } | null;
  guild(guildId: string): Guild | undefined;
  channels(guild: Guild): { readonly text: ChannelView[]; readonly voice: ChannelView[] };
  sendMessage(guild: Guild, input: SendMessageInput): Promise<SendResult>;
  runAction(guildId: string, action: PanelAction): Promise<ControlResult>;
}

/** CSP sem inline: HTML, CSS e JS vêm do próprio painel; imagens só as miniaturas do YouTube. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' https://i.ytimg.com",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

const HEARTBEAT_MS = 15_000;

function respond(status: number, body: unknown, extra: Record<string, string> = {}): PanelResponse {
  return {
    kind: 'body',
    status,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra },
    body: JSON.stringify(body),
  };
}

function error(status: number, message: string, extra: Record<string, string> = {}): PanelResponse {
  return respond(status, { ok: false, error: message }, extra);
}

function guardError(failure: GuardFailure): PanelResponse {
  const extra: Record<string, string> = failure.retryAfterSec ? { 'Retry-After': String(failure.retryAfterSec) } : {};
  return error(failure.status, failure.error, extra);
}

function asset(contentType: string, body: string): PanelResponse {
  return { kind: 'body', status: 200, headers: { ...SECURITY_HEADERS, 'Content-Type': contentType }, body };
}

function parseJson(request: PanelRequest): unknown {
  if (!(request.headers['content-type'] ?? '').startsWith('application/json')) return undefined;
  try {
    return JSON.parse(request.body) as unknown;
  } catch {
    return undefined;
  }
}

function rateLimited(retryAfterSec: number): PanelResponse {
  return guardError({ status: 429, error: `Muitas requisições. Tente de novo em ${retryAfterSec} s.`, retryAfterSec });
}

export class PanelApp {
  constructor(private readonly deps: PanelAppDeps) {}

  async handle(request: PanelRequest): Promise<PanelResponse> {
    const facts: RequestFacts = {
      method: request.method,
      host: request.headers['host'],
      origin: request.headers['origin'],
      csrf: request.headers[CSRF_HEADER],
    };
    const hostFailure = checkHost(facts, this.deps.port);
    if (hostFailure) return guardError(hostFailure);

    // A casca da página é pública; dados e ações exigem sessão.
    if (request.method === 'GET') {
      if (request.path === '/') return asset('text/html; charset=utf-8', this.deps.assets.html);
      if (request.path === '/app.css') return asset('text/css; charset=utf-8', this.deps.assets.css);
      if (request.path === '/app.js') return asset('text/javascript; charset=utf-8', this.deps.assets.js);
    }
    if (request.method === 'POST' && request.path === '/api/login') return this.login(request, facts);

    const session = this.deps.sessions.get(parseCookies(request.headers['cookie']).get(SESSION_COOKIE) ?? null);
    if (request.method === 'GET' && request.path === '/api/session') {
      return respond(200, session ? { ok: true, authenticated: true, csrf: session.csrf } : { ok: true, authenticated: false });
    }
    if (!session) return error(401, 'Faça login de novo.');

    if (request.method === 'POST') {
      const csrfFailure = checkCsrf(facts, session, this.deps.port);
      if (csrfFailure) return guardError(csrfFailure);
    }

    if (request.method === 'GET' && request.path === '/api/events') return this.events(session);
    if (request.method === 'POST' && request.path === '/api/logout') {
      this.deps.sessions.destroy(session.id);
      return respond(200, { ok: true }, { 'Set-Cookie': clearedCookie() });
    }

    const match = /^\/api\/guilds\/([^/]+)\/(channels|messages|actions)$/.exec(request.path);
    if (match) {
      const [, guildId = '', resource] = match;
      if (!isSnowflake(guildId)) return error(400, 'Servidor inválido.');
      const guild = this.deps.guild(guildId);
      if (!guild) return error(404, 'O bot não está nesse servidor.');
      if (request.method === 'GET' && resource === 'channels') return respond(200, { ok: true, ...this.deps.channels(guild) });
      if (request.method === 'POST' && resource === 'messages') return this.message(request, session, guild);
      if (request.method === 'POST' && resource === 'actions') return this.action(request, session, guildId);
    }
    return error(404, 'Rota não encontrada.');
  }

  private login(request: PanelRequest, facts: RequestFacts): PanelResponse {
    // Sem sessão ainda: o Origin é a proteção contra login forçado vindo de outro site.
    const origin = checkOrigin(facts, this.deps.port);
    if (origin) return guardError(origin);
    const wait = this.deps.limiters.login.take(`login:${request.remoteAddress}`);
    if (wait !== null) return rateLimited(wait);
    const body = parseJson(request);
    const token = typeof body === 'object' && body !== null && 'token' in body ? (body as { token: unknown }).token : undefined;
    if (typeof token !== 'string' || !safeEqual(token, this.deps.token)) return error(401, 'Token incorreto.');
    const session = this.deps.sessions.create();
    return respond(200, { ok: true, csrf: session.csrf }, { 'Set-Cookie': sessionCookie(session) });
  }

  private async message(request: PanelRequest, session: Session, guild: Guild): Promise<PanelResponse> {
    const wait = this.deps.limiters.message.take(`message:${session.id}`);
    if (wait !== null) return rateLimited(wait);
    const input = validateMessage(parseJson(request));
    if (!input.ok) return error(400, input.error);
    const result = await this.deps.sendMessage(guild, input.value);
    return result.ok ? respond(200, { ok: true, url: result.url, messageId: result.messageId }) : error(502, result.error);
  }

  private async action(request: PanelRequest, session: Session, guildId: string): Promise<PanelResponse> {
    const wait = this.deps.limiters.control.take(`control:${session.id}`);
    if (wait !== null) return rateLimited(wait);
    const action = validateAction(parseJson(request));
    if (!action.ok) return error(400, action.error);
    const result = await this.deps.runAction(guildId, action.value);
    this.deps.state.poke();
    // 409 = recusado sem efeito: a página desfaz o estado otimista.
    return result.ok ? respond(200, { ok: true, message: result.message }) : error(409, result.message);
  }

  private events(session: Session): PanelResponse {
    return {
      kind: 'sse',
      headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' },
      open: (stream) => {
        stream.send('state', this.deps.state.current());
        if (this.deps.logs) stream.send('logs', this.deps.logs.entries());
        const unsubscribeState = this.deps.state.subscribe((snapshot) => stream.send('state', snapshot));
        const unsubscribeLogs = this.deps.logs?.subscribe((entry) => stream.send('log', entry)) ?? (() => undefined);
        const heartbeat = setInterval(() => {
          // Sessão expirou (ou logout em outra aba): encerra o stream.
          if (!this.deps.sessions.get(session.id)) stream.close();
          else stream.comment('ping');
        }, HEARTBEAT_MS);
        heartbeat.unref();
        return () => {
          clearInterval(heartbeat);
          unsubscribeState();
          unsubscribeLogs();
        };
      },
    };
  }
}
