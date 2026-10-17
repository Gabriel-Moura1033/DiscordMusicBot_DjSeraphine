import { writeFile } from 'node:fs/promises';
import { Status, type Client } from 'discord.js';
import type { Config } from './config.js';
import { logger } from './logger.js';

const CHECK_INTERVAL_MS = 15_000;

/**
 * `client.ws.status` fica Ready para sempre depois do primeiro ready (discord.js 14);
 * quem reflete queda/reconexão é o status de cada shard.
 */
function gatewayStatus(client: Client): { readonly ready: boolean; readonly detail: string } {
  const shards = [...client.ws.shards.values()];
  const ready = shards.length > 0 && shards.every((shard) => shard.status === Status.Ready);
  return { ready, detail: shards.map((shard) => `${shard.id}:${Status[shard.status]}`).join(',') || 'sem shards' };
}

/**
 * Heartbeat para o HEALTHCHECK do container e saída com erro se o gateway ficar fora
 * por tempo demais (ADR-029). Retorna uma função que para o monitor.
 */
export function startHealthMonitor(client: Client, config: Config, onGatewayDead: () => void): () => void {
  let downSince: number | null = null;

  const check = async (): Promise<void> => {
    const gateway = gatewayStatus(client);
    if (gateway.ready) {
      if (downSince !== null) logger.info({ downForSec: Math.round((Date.now() - downSince) / 1000) }, 'gateway back');
      downSince = null;
      if (!config.heartbeatFile) return;
      try {
        await writeFile(config.heartbeatFile, String(Date.now()));
      } catch (error) {
        logger.warn({ err: error, file: config.heartbeatFile }, 'failed to write heartbeat');
      }
      return;
    }

    // Date.now() conta o tempo em que o host ficou suspenso (timers do Node não contam).
    downSince ??= Date.now();
    const downMs = Date.now() - downSince;
    logger.warn({ shards: gateway.detail, downForSec: Math.round(downMs / 1000) }, 'gateway not ready');
    if (config.gatewayDownExitMs > 0 && downMs > config.gatewayDownExitMs) {
      logger.fatal({ downForSec: Math.round(downMs / 1000) }, 'gateway down for too long, exiting');
      onGatewayDead();
    }
  };

  const interval = setInterval(() => void check(), CHECK_INTERVAL_MS);
  void check();
  return () => clearInterval(interval);
}
