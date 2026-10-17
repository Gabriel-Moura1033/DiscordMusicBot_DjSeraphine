import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { logger } from '../logger.js';

const STDERR_LIMIT = 16 * 1024;
const KILL_GRACE_MS = 2_000;

/**
 * Todo filho roda em um process group próprio (`detached`) e é sinalizado com `kill(-pid)`.
 * Necessário porque o binário standalone do yt-dlp (PyInstaller onefile) é um bootloader que
 * faz fork do interpretador, e o yt-dlp ainda pode iniciar o Deno.
 */
const liveGroups = new Set<ChildProcess>();

process.once('exit', () => {
  for (const child of liveGroups) signalGroup(child, 'SIGKILL');
});

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ESRCH') {
      logger.warn({ err: error, pid: child.pid, signal }, 'failed to signal process group');
    }
  }
}

/**
 * SIGTERM primeiro: o bootloader do PyInstaller repassa ao filho e apaga o diretório
 * extraído em /tmp (_MEIxxxx); com SIGKILL direto ele vazaria ~30 MB a cada skip.
 * SIGKILL só se o líder ainda estiver vivo depois do prazo.
 */
function terminateGroup(child: ChildProcess): void {
  if (child.pid === undefined || hasExited(child)) return;
  signalGroup(child, 'SIGTERM');
  setTimeout(() => {
    if (!hasExited(child)) signalGroup(child, 'SIGKILL');
  }, KILL_GRACE_MS).unref();
}

/** Processos filhos vivos (yt-dlp/ffmpeg; cada um conta como 1, sem os netos do grupo). */
export function activeChildCount(): number {
  return liveGroups.size;
}

/** Para o shutdown: espera todos os filhos fecharem (ou o prazo acabar). Retorna quantos sobraram. */
export async function waitForChildren(timeoutMs: number): Promise<number> {
  const pending = [...liveGroups].map(
    (child) => new Promise<void>((resolve) => {
      if (hasExited(child)) resolve();
      else child.once('close', () => resolve());
    }),
  );
  if (pending.length === 0) return 0;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.all(pending),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  return [...liveGroups].filter((child) => !hasExited(child)).length;
}

export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function track<T extends ChildProcess>(child: T): T {
  liveGroups.add(child);
  child.once('close', () => liveGroups.delete(child));
  return child;
}

/** Mantém só a cauda do stderr, que é onde o yt-dlp coloca o ERROR final. */
function captureTail(stream: Readable): () => string {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    if (buffer.length > STDERR_LIMIT) buffer = buffer.slice(-STDERR_LIMIT);
  });
  stream.on('error', () => undefined);
  return () => buffer;
}

function ignoreBrokenPipe(error: NodeJS.ErrnoException): void {
  if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') return;
  logger.warn({ err: error }, 'unexpected stdio error');
}

interface ExitInfo {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly spawnError: Error | null;
}

function waitExit(child: ChildProcess): Promise<ExitInfo> {
  return new Promise((resolve) => {
    let spawnError: Error | null = null;
    child.once('error', (error) => {
      spawnError = error;
      // Se o spawn falhou, 'close' pode não vir.
      if (child.pid === undefined) resolve({ code: null, signal: null, spawnError });
    });
    child.once('close', (code, signal) => resolve({ code, signal, spawnError }));
  });
}

export interface CaptureResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly spawnError: Error | null;
}

export async function runCapture(
  command: string,
  args: readonly string[],
  options: { readonly timeoutMs: number; readonly maxStdoutBytes: number },
): Promise<CaptureResult> {
  const child = track(spawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] }));
  const stderr = captureTail(child.stderr);

  const chunks: Buffer[] = [];
  let size = 0;
  let overflow = false;
  child.stdout.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > options.maxStdoutBytes) {
      overflow = true;
      terminateGroup(child);
      return;
    }
    chunks.push(chunk);
  });
  child.stdout.on('error', () => undefined);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    terminateGroup(child);
  }, options.timeoutMs);

  const exit = await waitExit(child);
  clearTimeout(timer);

  const stderrText = overflow ? `${stderr()}\n[dj] stdout excedeu ${options.maxStdoutBytes} bytes` : stderr();
  return {
    code: overflow ? null : exit.code,
    stdout: Buffer.concat(chunks).toString('utf8'),
    stderr: stderrText,
    timedOut,
    spawnError: exit.spawnError,
  };
}

export interface PipelineResult {
  readonly killed: boolean;
  readonly source: ExitInfo & { readonly stderr: string };
  readonly decoder: ExitInfo & { readonly stderr: string };
}

export interface Pipeline {
  /** Saída do decodificador (PCM). */
  readonly output: Readable;
  /** Resolve quando os dois processos terminaram. */
  readonly done: Promise<PipelineResult>;
  /** Idempotente. */
  kill(): void;
}

/** `source.stdout → decoder.stdin`; a saída do pipeline é `decoder.stdout`. */
export function spawnPipeline(
  source: { readonly command: string; readonly args: readonly string[] },
  decoder: { readonly command: string; readonly args: readonly string[] },
): Pipeline {
  const src: ChildProcessByStdio<null, Readable, Readable> = track(
    spawn(source.command, source.args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] }),
  );
  const dec: ChildProcessByStdio<Writable, Readable, Readable> = track(
    spawn(decoder.command, decoder.args, { detached: true, stdio: ['pipe', 'pipe', 'pipe'] }),
  );

  const srcStderr = captureTail(src.stderr);
  const decStderr = captureTail(dec.stderr);

  src.stdout.on('error', ignoreBrokenPipe);
  dec.stdin.on('error', ignoreBrokenPipe);
  src.stdout.pipe(dec.stdin);

  let killed = false;
  let finished = false;
  const kill = (): void => {
    if (killed || finished) return;
    killed = true;
    src.stdout.unpipe(dec.stdin);
    // Sem isso, um ffmpeg bloqueado escrevendo num stdout que ninguém lê ignora o SIGTERM
    // e o 'close' nunca dispara (o Node espera os pipes fecharem).
    src.stdout.destroy();
    dec.stdin.destroy();
    dec.stdout.destroy();
    terminateGroup(src);
    terminateGroup(dec);
  };

  const done = Promise.all([waitExit(src), waitExit(dec)]).then(([srcExit, decExit]): PipelineResult => {
    finished = true;
    return {
      killed,
      source: { ...srcExit, stderr: srcStderr() },
      decoder: { ...decExit, stderr: decStderr() },
    };
  });

  return { output: dec.stdout, done, kill };
}
