/**
 * Partes puras do logging (sem depender da config): redact, limpeza de segredos nas linhas e o
 * ring buffer que alimenta os logs ao vivo do painel (ADR-045).
 */

export const REDACT_CENSOR = '[redacted]';

/** Chaves que nunca saem nos logs, em qualquer nível de aninhamento comum. */
export const REDACT_PATHS = [
  'token',
  '*.token',
  'discordToken',
  '*.discordToken',
  'panelToken',
  '*.panelToken',
  'password',
  '*.password',
  'authorization',
  '*.authorization',
  'headers.authorization',
  '*.headers.authorization',
  'cookie',
  '*.cookie',
  'headers.cookie',
  '*.headers.cookie',
  'csrf',
  '*.csrf',
  'session',
  '*.session',
];

/**
 * Segunda barreira: troca o valor literal de cada segredo por `[redacted]` em qualquer lugar da
 * linha (ex.: token dentro da mensagem de um erro), antes de ir para o stdout ou para o buffer.
 */
export function makeScrubber(secrets: readonly string[]): (line: string) => string {
  const values = secrets.filter((secret) => secret.length >= 8);
  if (values.length === 0) return (line) => line;
  return (line) => values.reduce((text, secret) => text.split(secret).join(REDACT_CENSOR), line);
}

export interface LogEntry {
  readonly seq: number;
  /** ms desde a época. */
  readonly time: number;
  /** Nível numérico do pino (10 trace … 60 fatal). */
  readonly level: number;
  readonly msg: string;
  readonly guildId: string | null;
  /** Demais campos da linha (sem pid/hostname/time/level/msg). */
  readonly fields: Record<string, unknown>;
}

const OMITTED_FIELDS = new Set(['pid', 'hostname', 'time', 'level', 'msg']);

/** Converte uma linha JSON do pino; `null` se não for um objeto de log. */
export function parseLogLine(line: string, seq: number): LogEntry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!OMITTED_FIELDS.has(key)) fields[key] = value;
  }
  return {
    seq,
    time: typeof record['time'] === 'number' ? record['time'] : Date.now(),
    level: typeof record['level'] === 'number' ? record['level'] : 30,
    msg: typeof record['msg'] === 'string' ? record['msg'] : '',
    guildId: typeof record['guildId'] === 'string' ? record['guildId'] : null,
    fields,
  };
}

/** Últimas `capacity` entradas, com assinantes para o streaming. */
export class LogBuffer {
  private readonly items: LogEntry[] = [];
  private readonly listeners = new Set<(entry: LogEntry) => void>();
  private sequence = 0;

  constructor(readonly capacity: number) {}

  /** Destino de stream para o pino (recebe linhas JSON). */
  write(line: string): void {
    const entry = parseLogLine(line, ++this.sequence);
    if (!entry) return;
    this.items.push(entry);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // Um assinante quebrado (conexão SSE caída) não pode afetar o log.
      }
    }
  }

  entries(): readonly LogEntry[] {
    return [...this.items];
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
