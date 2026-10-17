import { pino, type DestinationStream, type StreamEntry } from 'pino';
import { config } from './config.js';
import { LogBuffer, makeScrubber, REDACT_CENSOR, REDACT_PATHS } from './logging.js';

/** Logs ao vivo do painel; `null` com o painel desligado (não paga o parse de cada linha). */
export const logBuffer: LogBuffer | null = config.panel ? new LogBuffer(config.panel.logBuffer) : null;

const scrub = makeScrubber([config.discordToken, ...(config.panel ? [config.panel.token] : [])]);

function scrubbing(target: { write(line: string): unknown }): DestinationStream {
  return { write: (line: string) => void target.write(scrub(line)) };
}

// stdout continua igual (JSON em produção, pino-pretty em dev); o buffer recebe a mesma linha.
const output: { write(line: string): unknown } = config.isProduction
  ? pino.destination(1)
  : pino.transport({ target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } });

const streams: StreamEntry[] = [{ level: 'trace', stream: scrubbing(output) }];
if (logBuffer) streams.push({ level: 'trace', stream: scrubbing(logBuffer) });

export const logger = pino(
  { level: config.logLevel, redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR } },
  pino.multistream(streams),
);
