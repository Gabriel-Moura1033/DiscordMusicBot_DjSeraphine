import { describe, expect, it } from 'vitest';
import {
  allowedHosts,
  checkCsrf,
  checkHost,
  checkOrigin,
  clearedCookie,
  parseCookies,
  RateLimiter,
  safeEqual,
  SessionStore,
  sessionCookie,
  type RequestFacts,
} from '../src/panel/security.js';

const PORT = 8787;
const facts = (partial: Partial<RequestFacts>): RequestFacts => ({ method: 'POST', host: undefined, origin: undefined, csrf: undefined, ...partial });

describe('token e sessões', () => {
  it('safeEqual compara qualquer tamanho sem atalho', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('sessão expira no TTL e pode ser destruída', () => {
    let now = 0;
    const store = new SessionStore(1000, () => now);
    const session = store.create();
    expect(store.get(session.id)).toEqual(session);
    expect(session.csrf).not.toBe(session.id);
    now = 999;
    expect(store.get(session.id)).not.toBeNull();
    now = 1000;
    expect(store.get(session.id)).toBeNull();
    const other = store.create();
    store.destroy(other.id);
    expect(store.get(other.id)).toBeNull();
    expect(store.get(null)).toBeNull();
    expect(store.get('inventado')).toBeNull();
  });

  it('cookie HttpOnly + SameSite=Strict, sem Secure (HTTP local); logout zera', () => {
    const store = new SessionStore();
    const cookie = sessionCookie(store.create());
    expect(cookie).toMatch(/^dj_session=[\w-]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200$/);
    expect(clearedCookie()).toContain('Max-Age=0');
    expect(parseCookies('a=1; dj_session=xyz ; b=2').get('dj_session')).toBe('xyz');
    expect(parseCookies(undefined).size).toBe(0);
  });
});

describe('Host, Origin e CSRF', () => {
  it('Host: só localhost e 127.0.0.1 na porta do painel', () => {
    expect([...allowedHosts(PORT)]).toEqual(['localhost:8787', '127.0.0.1:8787']);
    expect(checkHost(facts({ host: 'localhost:8787' }), PORT)).toBeNull();
    expect(checkHost(facts({ host: '127.0.0.1:8787' }), PORT)).toBeNull();
    expect(checkHost(facts({ host: '192.168.0.10:8787' }), PORT)?.status).toBe(403);
    expect(checkHost(facts({ host: 'evil.example:8787' }), PORT)?.status).toBe(403);
    expect(checkHost(facts({ host: 'localhost:9999' }), PORT)?.status).toBe(403);
    expect(checkHost(facts({}), PORT)?.status).toBe(403);
  });

  it('Origin: aceita http://localhost:PORT e http://127.0.0.1:PORT; recusa o resto e a ausência', () => {
    expect(checkOrigin(facts({ origin: 'http://localhost:8787' }), PORT)).toBeNull();
    expect(checkOrigin(facts({ origin: 'http://127.0.0.1:8787' }), PORT)).toBeNull();
    for (const origin of ['https://localhost:8787', 'http://localhost:1234', 'http://evil.example', 'null', undefined]) {
      expect(checkOrigin(facts({ origin }), PORT)?.status).toBe(403);
    }
  });

  it('CSRF: exige Origin permitido e o token da sessão', () => {
    const session = new SessionStore().create();
    const origin = 'http://localhost:8787';
    expect(checkCsrf(facts({ origin, csrf: session.csrf }), session, PORT)).toBeNull();
    expect(checkCsrf(facts({ origin, csrf: 'outro' }), session, PORT)?.status).toBe(403);
    expect(checkCsrf(facts({ origin }), session, PORT)?.status).toBe(403);
    expect(checkCsrf(facts({ origin: 'http://evil.example', csrf: session.csrf }), session, PORT)?.error).toBe('Origem não permitida.');
  });
});

describe('RateLimiter', () => {
  it('libera até o limite na janela, informa a espera e reabre depois', () => {
    let now = 0;
    const limiter = new RateLimiter(5, 60_000, () => now);
    for (let i = 0; i < 5; i++) expect(limiter.take('msg:a')).toBeNull();
    expect(limiter.take('msg:a')).toBe(60);
    now = 30_000;
    expect(limiter.take('msg:a')).toBe(30);
    expect(limiter.take('msg:b')).toBeNull();
    now = 60_000;
    expect(limiter.take('msg:a')).toBeNull();
  });
});
