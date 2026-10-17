/**
 * Transporte HTTP do painel (node:http puro, ADR-046) e montagem das dependências reais.
 * Escuta em PANEL_HOST (127.0.0.1 fora do container; 0.0.0.0 dentro, com a porta publicada só em
 * 127.0.0.1 do host).
 */
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Status, type Client } from 'discord.js';
import type { PanelConfig } from '../config.js';
import { logger, logBuffer } from '../logger.js';
import type { PlayerManager } from '../player/PlayerManager.js';
import { activeChildCount } from '../youtube/process.js';
import type { YouTubeService } from '../youtube/YouTubeService.js';
import { runAction } from './actions.js';
import { PanelApp, SECURITY_HEADERS, type PanelAssets, type PanelRequest, type PanelResponse, type SseStream } from './app.js';
import { listChannels, sendMessage } from './discord.js';
import { RATE_LIMITS, RateLimiter, SessionStore } from './security.js';
import { StateHub } from './state.js';

const MAX_BODY_BYTES = 16 * 1024;

function loadAssets(): PanelAssets {
  const read = (name: string) => readFileSync(new URL(`./public/${name}`, import.meta.url), 'utf8');
  return { html: read('index.html'), css: read('app.css'), js: read('app.js') };
}

class BodyTooLarge extends Error {}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLarge());
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function headersOf(request: IncomingMessage): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) headers[name] = Array.isArray(value) ? value.join(', ') : value;
  return headers;
}

export interface PanelDeps {
  readonly config: PanelConfig;
  readonly client: Client;
  readonly players: PlayerManager;
  readonly youtube: YouTubeService;
  readonly ytdlpVersion: string | null;
  readonly startedAt: number;
}

export class PanelServer {
  private readonly server: Server;
  private readonly app: PanelApp;
  readonly state: StateHub;
  private readonly streams = new Set<ServerResponse>();

  constructor(private readonly deps: PanelDeps) {
    const { client, players, config } = deps;
    this.state = new StateHub({
      guilds: () => [...client.guilds.cache.values()].map((guild) => ({ id: guild.id, name: guild.name })),
      channelName: (guildId, channelId) => client.guilds.cache.get(guildId)?.channels.cache.get(channelId)?.name ?? null,
      player: (guildId) => players.peek(guildId),
      settings: (guildId) => players.settingsFor(guildId),
      bot: () => ({
        ready: client.ws.shards.size > 0 && [...client.ws.shards.values()].every((shard) => shard.status === Status.Ready),
        user: client.user?.tag ?? null,
        startedAt: deps.startedAt,
        ytdlpVersion: deps.ytdlpVersion,
        children: activeChildCount(),
      }),
      now: Date.now,
    });

    this.app = new PanelApp({
      port: config.port,
      token: config.token,
      sessions: new SessionStore(),
      limiters: {
        login: new RateLimiter(RATE_LIMITS.login.limit, RATE_LIMITS.login.windowMs),
        message: new RateLimiter(RATE_LIMITS.message.limit, RATE_LIMITS.message.windowMs),
        control: new RateLimiter(RATE_LIMITS.control.limit, RATE_LIMITS.control.windowMs),
      },
      assets: loadAssets(),
      state: this.state,
      logs: logBuffer,
      guild: (guildId) => client.guilds.cache.get(guildId),
      channels: listChannels,
      sendMessage,
      runAction: (guildId, action) =>
        runAction(
          {
            players,
            youtube: deps.youtube,
            guild: (id) => client.guilds.cache.get(id),
            announce: config.announceActions,
          },
          guildId,
          action,
        ),
    });

    this.server = createServer((request, response) => void this.serve(request, response));
    // SSE fica aberto indefinidamente; o timeout de requisição só vale para receber o corpo.
    this.server.requestTimeout = 30_000;
    this.server.headersTimeout = 10_000;
  }

  /** Mudanças vindas de eventos do player (faixa começou/terminou) aparecem na hora. */
  notifyChange(): void {
    this.state.poke();
  }

  start(): Promise<void> {
    const { host, port } = this.deps.config;
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => {
        this.server.off('error', reject);
        logger.info({ host, port }, 'panel listening');
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    this.state.stop();
    for (const stream of this.streams) stream.end();
    this.streams.clear();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private async serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body = '';
    try {
      if (request.method === 'POST') body = await readBody(request);
    } catch (error) {
      if (error instanceof BodyTooLarge) this.write(response, 413, { ok: false, error: 'Requisição grande demais.' });
      return;
    }
    const url = new URL(request.url ?? '/', 'http://panel.local');
    const panelRequest: PanelRequest = {
      method: request.method ?? 'GET',
      path: url.pathname,
      headers: headersOf(request),
      body,
      remoteAddress: request.socket.remoteAddress ?? 'unknown',
    };
    let result: PanelResponse;
    try {
      result = await this.app.handle(panelRequest);
    } catch (error) {
      logger.error({ err: error, path: panelRequest.path }, 'panel request failed');
      this.write(response, 500, { ok: false, error: 'Erro inesperado no painel.' });
      return;
    }
    if (result.kind === 'body') {
      response.writeHead(result.status, result.headers);
      response.end(result.body);
      return;
    }
    this.openStream(response, result);
  }

  private openStream(response: ServerResponse, result: Extract<PanelResponse, { kind: 'sse' }>): void {
    response.writeHead(200, result.headers);
    this.streams.add(response);
    const stream: SseStream = {
      send: (event, data) => void response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      comment: (text) => void response.write(`: ${text}\n\n`),
      close: () => response.end(),
    };
    const cleanup = result.open(stream);
    response.on('close', () => {
      cleanup();
      this.streams.delete(response);
    });
  }

  private write(response: ServerResponse, status: number, body: unknown): void {
    if (response.headersSent) return;
    response.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
  }
}
