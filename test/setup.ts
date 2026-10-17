import { vi } from 'vitest';

// Testes precisam ser puros (ADR-028): qualquer tentativa de rede ou de processo externo falha alto.
function forbidden(what: string): never {
  throw new Error(`${what} não é permitido nos testes (devem ser puros: sem rede, yt-dlp ou ffmpeg)`);
}

vi.mock('node:child_process', () => ({
  spawn: () => forbidden('child_process.spawn'),
  execFile: () => forbidden('child_process.execFile'),
  exec: () => forbidden('child_process.exec'),
  fork: () => forbidden('child_process.fork'),
}));

vi.stubGlobal('fetch', () => forbidden('fetch'));

// O logger real carrega a config (que exige DISCORD_TOKEN etc. e encerra o processo sem eles).
vi.mock('../src/logger.js', () => {
  const noop = (): void => undefined;
  const silent = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, child: () => silent };
  return { logger: silent };
});
