/**
 * Presença "Ouvindo <título>" (ADR-032). A presença é global ao bot, mas cada guild tem seu player:
 * mostra a faixa que começou mais recentemente entre as guilds que estão tocando. Quando ela para,
 * volta para a próxima mais recente; sem nenhuma, limpa. Pausar não muda nada.
 */

export interface PlayingEntry {
  readonly title: string;
  readonly startedAt: number;
}

export function selectPresence(playing: ReadonlyMap<string, PlayingEntry>): string | null {
  let best: PlayingEntry | null = null;
  for (const entry of playing.values()) {
    if (!best || entry.startedAt >= best.startedAt) best = entry;
  }
  return best?.title ?? null;
}

export interface PresenceOptions {
  readonly apply: (title: string | null) => void;
  /** O gateway limita atualizações de presença; agrupa mudanças rápidas (ex.: vários /skip). */
  readonly minIntervalMs?: number;
  readonly now?: () => number;
}

export class PresenceTracker {
  private readonly playing = new Map<string, PlayingEntry>();
  private readonly apply: (title: string | null) => void;
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  /** `undefined` = nunca aplicada (ou precisa reaplicar após nova sessão do gateway). */
  private applied: string | null | undefined = undefined;
  private lastApplyAt = Number.NEGATIVE_INFINITY;
  private timer: NodeJS.Timeout | null = null;
  private sequence = 0;

  constructor(options: PresenceOptions) {
    this.apply = options.apply;
    this.minIntervalMs = options.minIntervalMs ?? 5_000;
    this.now = options.now ?? Date.now;
  }

  started(guildId: string, title: string): void {
    // Sequência desempata faixas iniciadas no mesmo milissegundo.
    this.playing.set(guildId, { title, startedAt: this.now() + ++this.sequence / 1e6 });
    this.schedule();
  }

  finished(guildId: string): void {
    if (this.playing.delete(guildId)) this.schedule();
  }

  /** Nova sessão do gateway começa sem presença; força reaplicar. */
  refresh(): void {
    this.applied = undefined;
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.timer) return;
    const wait = Math.max(0, this.lastApplyAt + this.minIntervalMs - this.now());
    this.timer = setTimeout(() => this.flush(), wait);
    this.timer.unref();
  }

  private flush(): void {
    this.timer = null;
    const desired = selectPresence(this.playing);
    if (desired === this.applied) return;
    this.applied = desired;
    this.lastApplyAt = this.now();
    this.apply(desired);
  }
}
