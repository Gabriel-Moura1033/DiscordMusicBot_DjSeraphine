import type { Guild } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { CONTENT_SECURITY_POLICY, PanelApp, type PanelAppDeps, type PanelRequest, type PanelResponse } from '../src/panel/app.js';
import { RateLimiter, SessionStore } from '../src/panel/security.js';
import type { PanelSnapshot } from '../src/panel/state.js';

const PORT = 8787;
const TOKEN = 'token-do-painel-com-mais-de-32-caracteres!';
const GUILD = '123456789012345678';
const CHANNEL = '223456789012345678';
const ORIGIN = 'http://localhost:8787';

const snapshot: PanelSnapshot = {
  at: 1,
  bot: { ready: true, user: 'DJ#1', startedAt: 0, ytdlpVersion: '1', children: 0 },
  guilds: [],
  features: { seek: true, previous: true, replay: true, autoplay: true, filter: true },
};

function setup(overrides: Partial<PanelAppDeps> = {}) {
  let now = 0;
  const runAction = vi.fn<PanelAppDeps['runAction']>(() => Promise.resolve({ ok: true, message: '⏭️ Pulei.' }));
  const sendMessage = vi.fn<PanelAppDeps['sendMessage']>(() =>
    Promise.resolve({ ok: true, url: 'https://discord.com/channels/1/2/3', messageId: '3' }),
  );
  const poke = vi.fn();
  const deps: PanelAppDeps = {
    port: PORT,
    token: TOKEN,
    sessions: new SessionStore(),
    limiters: {
      login: new RateLimiter(5, 60_000, () => now),
      message: new RateLimiter(5, 60_000, () => now),
      control: new RateLimiter(60, 60_000, () => now),
    },
    assets: { html: '<!doctype html>', css: 'body{}', js: '"use strict";' },
    state: { current: () => snapshot, subscribe: () => () => undefined, poke },
    logs: { entries: () => [], subscribe: () => () => undefined },
    guild: (id) => (id === GUILD ? ({ id } as Guild) : undefined),
    channels: () => ({ text: [{ id: CHANNEL, name: 'geral' }], voice: [] }),
    sendMessage,
    runAction,
    ...overrides,
  };
  const app = new PanelApp(deps);
  const request = (partial: Partial<PanelRequest> & { json?: unknown }): Promise<PanelResponse> =>
    app.handle({
      method: partial.method ?? 'GET',
      path: partial.path ?? '/',
      headers: {
        host: 'localhost:8787',
        ...(partial.json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...partial.headers,
      },
      body: partial.json !== undefined ? JSON.stringify(partial.json) : (partial.body ?? ''),
      remoteAddress: partial.remoteAddress ?? '127.0.0.1',
    });
  const login = async () => {
    const response = await request({ method: 'POST', path: '/api/login', headers: { origin: ORIGIN }, json: { token: TOKEN } });
    if (response.kind !== 'body') throw new Error('esperado corpo');
    const cookie = (response.headers['Set-Cookie'] ?? '').split(';')[0] ?? '';
    const { csrf } = JSON.parse(response.body) as { csrf: string };
    return { cookie, csrf };
  };
  const post = async (path: string, json: unknown, auth: { cookie: string; csrf: string }, origin = ORIGIN) =>
    request({ method: 'POST', path, headers: { cookie: auth.cookie, origin, 'x-csrf-token': auth.csrf }, json });
  return { app, request, login, post, runAction, sendMessage, poke, advance: (ms: number) => (now += ms) };
}

function body(response: PanelResponse): { status: number; json: Record<string, unknown> } {
  if (response.kind !== 'body') throw new Error('esperado corpo');
  return { status: response.status, json: JSON.parse(response.body) as Record<string, unknown> };
}

describe('página e headers', () => {
  it('serve HTML, CSS e JS com CSP sem inline e headers de segurança', async () => {
    const { request } = setup();
    for (const [path, type] of [['/', 'text/html'], ['/app.css', 'text/css'], ['/app.js', 'text/javascript']] as const) {
      const response = await request({ path });
      if (response.kind !== 'body') throw new Error();
      expect(response.status).toBe(200);
      expect(response.headers['Content-Type']).toContain(type);
      expect(response.headers['Content-Security-Policy']).toBe(CONTENT_SECURITY_POLICY);
      expect(response.headers['X-Frame-Options']).toBe('DENY');
      expect(response.headers['X-Content-Type-Options']).toBe('nosniff');
    }
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("style-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe');
  });

  it('Host diferente de localhost/127.0.0.1 é recusado em qualquer rota (DNS rebinding)', async () => {
    const { request } = setup();
    expect(body(await request({ path: '/', headers: { host: '192.168.1.20:8787' } })).status).toBe(403);
    const allowed = await request({ path: '/', headers: { host: '127.0.0.1:8787' } });
    expect(allowed.kind === 'body' && allowed.status).toBe(200);
  });
});

describe('login e sessão', () => {
  it('sem sessão: dados e ações exigem login', async () => {
    const { request } = setup();
    expect(body(await request({ path: '/api/session' })).json).toEqual({ ok: true, authenticated: false });
    expect(body(await request({ path: '/api/events' })).status).toBe(401);
    expect(body(await request({ path: `/api/guilds/${GUILD}/channels` })).status).toBe(401);
    expect(body(await request({ method: 'POST', path: `/api/guilds/${GUILD}/actions`, json: { type: 'skip' } })).status).toBe(401);
  });

  it('token errado: 401; certo: cookie HttpOnly/SameSite=Strict + CSRF', async () => {
    const { request } = setup();
    const wrong = await request({ method: 'POST', path: '/api/login', headers: { origin: ORIGIN }, json: { token: 'errado' } });
    expect(body(wrong)).toEqual({ status: 401, json: { ok: false, error: 'Token incorreto.' } });
    const right = await request({ method: 'POST', path: '/api/login', headers: { origin: ORIGIN }, json: { token: TOKEN } });
    if (right.kind !== 'body') throw new Error();
    expect(right.headers['Set-Cookie']).toMatch(/HttpOnly; SameSite=Strict/);
    expect(body(right).json['csrf']).toEqual(expect.any(String));
  });

  it('login vindo de outra origem é recusado', async () => {
    const { request } = setup();
    const response = await request({ method: 'POST', path: '/api/login', headers: { origin: 'http://evil.example' }, json: { token: TOKEN } });
    expect(body(response).status).toBe(403);
  });

  it('5 tentativas de login por minuto', async () => {
    const { request, advance } = setup();
    const attempt = () => request({ method: 'POST', path: '/api/login', headers: { origin: ORIGIN }, json: { token: 'x' } });
    for (let i = 0; i < 5; i++) expect(body(await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(body(blocked).status).toBe(429);
    if (blocked.kind === 'body') expect(blocked.headers['Retry-After']).toBe('60');
    advance(60_000);
    expect(body(await attempt()).status).toBe(401);
  });

  it('com sessão: /api/session devolve o CSRF; logout encerra', async () => {
    const { request, login, post } = setup();
    const auth = await login();
    expect(body(await request({ path: '/api/session', headers: { cookie: auth.cookie } })).json).toEqual({
      ok: true,
      authenticated: true,
      csrf: auth.csrf,
    });
    expect(body(await post('/api/logout', {}, auth)).status).toBe(200);
    expect(body(await request({ path: '/api/session', headers: { cookie: auth.cookie } })).json['authenticated']).toBe(false);
  });
});

describe('CSRF e Origin nas rotas que alteram estado', () => {
  it('sem token CSRF, com token errado ou Origin estranho: 403 e nada executa', async () => {
    const { login, post, request, runAction } = setup();
    const auth = await login();
    const path = `/api/guilds/${GUILD}/actions`;
    expect(body(await post(path, { type: 'skip' }, { ...auth, csrf: 'errado' })).status).toBe(403);
    expect(body(await post(path, { type: 'skip' }, auth, 'http://evil.example')).status).toBe(403);
    expect(
      body(await request({ method: 'POST', path, headers: { cookie: auth.cookie, origin: ORIGIN }, json: { type: 'skip' } })).status,
    ).toBe(403);
    expect(runAction).not.toHaveBeenCalled();
  });

  it('Origin http://127.0.0.1:PORT também vale', async () => {
    const { login, post, runAction } = setup();
    const auth = await login();
    expect(body(await post(`/api/guilds/${GUILD}/actions`, { type: 'skip' }, auth, 'http://127.0.0.1:8787')).status).toBe(200);
    expect(runAction).toHaveBeenCalledWith(GUILD, { type: 'skip' });
  });
});

describe('rotas de controle', () => {
  it('valida a entrada antes de chamar a camada de controle', async () => {
    const { login, post, runAction } = setup();
    const auth = await login();
    expect(body(await post(`/api/guilds/${GUILD}/actions`, { type: 'volume', level: 500 }, auth))).toEqual({
      status: 400,
      json: { ok: false, error: 'Volume deve ser um inteiro de 0 a 100.' },
    });
    expect(runAction).not.toHaveBeenCalled();
  });

  it('sucesso: 200 com a mensagem e atualização imediata do estado; recusa: 409', async () => {
    const { login, post, runAction, poke } = setup();
    const auth = await login();
    expect(body(await post(`/api/guilds/${GUILD}/actions`, { type: 'skip' }, auth))).toEqual({
      status: 200,
      json: { ok: true, message: '⏭️ Pulei.' },
    });
    expect(poke).toHaveBeenCalledTimes(1);
    runAction.mockResolvedValueOnce({ ok: false, message: 'Essa faixa não está mais na fila.' });
    expect(body(await post(`/api/guilds/${GUILD}/actions`, { type: 'remove', id: 'q9' }, auth))).toEqual({
      status: 409,
      json: { ok: false, error: 'Essa faixa não está mais na fila.' },
    });
  });

  it('servidor desconhecido ou inválido', async () => {
    const { login, post } = setup();
    const auth = await login();
    expect(body(await post('/api/guilds/999999999999999999/actions', { type: 'skip' }, auth)).status).toBe(404);
    expect(body(await post('/api/guilds/abc/actions', { type: 'skip' }, auth)).status).toBe(400);
  });

  it('60 ações por minuto', async () => {
    const { login, post } = setup();
    const auth = await login();
    for (let i = 0; i < 60; i++) expect(body(await post(`/api/guilds/${GUILD}/actions`, { type: 'skip' }, auth)).status).toBe(200);
    expect(body(await post(`/api/guilds/${GUILD}/actions`, { type: 'skip' }, auth)).status).toBe(429);
  });
});

describe('mensagens', () => {
  it('valida, envia e devolve o link; 5 por minuto', async () => {
    const { login, post, sendMessage } = setup();
    const auth = await login();
    const path = `/api/guilds/${GUILD}/messages`;
    expect(body(await post(path, { channelId: CHANNEL, content: 'x'.repeat(2001) }, auth)).status).toBe(400);
    expect(body(await post(path, { channelId: CHANNEL, content: 'oi' }, auth))).toEqual({
      status: 200,
      json: { ok: true, url: 'https://discord.com/channels/1/2/3', messageId: '3' },
    });
    expect(sendMessage).toHaveBeenCalledWith({ id: GUILD }, expect.objectContaining({ content: 'oi', allowMentions: false }));
    for (let i = 0; i < 3; i++) await post(path, { channelId: CHANNEL, content: 'oi' }, auth);
    expect(body(await post(path, { channelId: CHANNEL, content: 'oi' }, auth)).status).toBe(429);
  });

  it('erro do Discord vira 502 com texto legível', async () => {
    const { login, post } = setup({ sendMessage: () => Promise.resolve({ ok: false, error: 'O bot não tem permissão para isso nesse canal.' }) });
    const auth = await login();
    expect(body(await post(`/api/guilds/${GUILD}/messages`, { channelId: CHANNEL, content: 'oi' }, auth))).toEqual({
      status: 502,
      json: { ok: false, error: 'O bot não tem permissão para isso nesse canal.' },
    });
  });

  it('lista de canais exige sessão e o bot no servidor', async () => {
    const { login, request } = setup();
    const auth = await login();
    expect(body(await request({ path: `/api/guilds/${GUILD}/channels`, headers: { cookie: auth.cookie } })).json).toEqual({
      ok: true,
      text: [{ id: CHANNEL, name: 'geral' }],
      voice: [],
    });
  });
});

describe('SSE', () => {
  it('ao abrir manda o estado e o buffer de logs; ao fechar cancela as assinaturas', async () => {
    const unsubscribeState = vi.fn();
    const unsubscribeLogs = vi.fn();
    const entry = { seq: 1, time: 1, level: 30, msg: 'bot ready', guildId: null, fields: {} };
    const { login, request } = setup({
      state: { current: () => snapshot, subscribe: () => unsubscribeState, poke: () => undefined },
      logs: { entries: () => [entry], subscribe: () => unsubscribeLogs },
    });
    const auth = await login();
    const response = await request({ path: '/api/events', headers: { cookie: auth.cookie } });
    if (response.kind !== 'sse') throw new Error('esperado SSE');
    expect(response.headers['Content-Type']).toContain('text/event-stream');
    const sent: [string, unknown][] = [];
    const close = response.open({ send: (event, data) => sent.push([event, data]), comment: () => undefined, close: () => undefined });
    expect(sent).toEqual([
      ['state', snapshot],
      ['logs', [entry]],
    ]);
    close();
    expect(unsubscribeState).toHaveBeenCalled();
    expect(unsubscribeLogs).toHaveBeenCalled();
  });
});
