import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { logger } from '../logger.js';

const STDERR_LIMIT = 16 * 1024;

/**
 * Todo filho roda em um process group próprio (`detached`) e é morto com `kill(-pid)`.
 * Necessário porque o binário standalone do yt-dlp (PyInstaller) faz fork de um segundo
 * processo, e o yt-dlp ainda pode iniciar o Deno; SIGKILL só no pid principal deixaria órfãos.
 */
const liveGroups = new Set<ChildProcess>();

process.once('exit', () => {
  for (const child of liveGroups) killGroup(child);
});

function killGroup(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ESRCH') {
      logger.warn({ err: error, pid: child.pid }, 'failed to kill process group');
    }
  }
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
      killGroup(child);
      return;
    }
    chunks.push(chunk);
  });
  child.stdout.on('error', () => undefined);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup(child);
  }, options.timeoutMs);

  const exit = await waitExit(child);
  clearTimeout(timer);
  killGroup(child);

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
    killGroup(src);
    killGroup(dec);
  };

  const done = Promise.all([waitExit(src), waitExit(dec)]).then(([srcExit, decExit]): PipelineResult => {
    // O líder do grupo pode sair antes dos filhos (PyInstaller/Deno); garante que nada sobra.
    killGroup(src);
    killGroup(dec);
    // Depois disso o pgid pode ser reutilizado pelo SO; kill() vira no-op.
    finished = true;
    return {
      killed,
      source: { ...srcExit, stderr: srcStderr() },
      decoder: { ...decExit, stderr: decStderr() },
    };
  });

  return { output: dec.stdout, done, kill };
}
