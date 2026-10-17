import type { Track } from '../youtube/YouTubeService.js';

export type LoopMode = 'off' | 'track' | 'queue';

export interface AdvanceOptions {
  /** Ignora o loop de faixa (usado por /skip e em falhas). */
  readonly skip: boolean;
  /** Não devolve a faixa atual ao fim da fila no loop de fila (usado por /stop e em falhas). */
  readonly drop: boolean;
}

export class Queue {
  current: Track | null = null;
  loopMode: LoopMode = 'off';
  private items: Track[] = [];

  get upcoming(): readonly Track[] {
    return this.items;
  }

  get size(): number {
    return this.items.length;
  }

  /** Soma das durações conhecidas dos próximos itens; `unknown` conta os sem duração. */
  get upcomingDuration(): { readonly seconds: number; readonly unknown: number } {
    let seconds = 0;
    let unknown = 0;
    for (const track of this.items) {
      if (track.durationSec === null) unknown++;
      else seconds += track.durationSec;
    }
    return { seconds, unknown };
  }

  add(tracks: readonly Track[]): void {
    this.items.push(...tracks);
  }

  /** Insere no início dos próximos, mantendo a ordem de `tracks`. */
  addFront(tracks: readonly Track[]): void {
    this.items.unshift(...tracks);
  }

  /** Define e retorna a próxima faixa atual (ou `null` se acabou). */
  advance(options: AdvanceOptions): Track | null {
    const previous = this.current;
    if (previous && this.loopMode === 'track' && !options.skip) return previous;
    if (previous && this.loopMode === 'queue' && !options.drop) this.items.push(previous);
    this.current = this.items.shift() ?? null;
    return this.current;
  }

  /** `position` é 1-based sobre os próximos itens (1 = a próxima faixa). */
  remove(position: number): Track | null {
    if (!Number.isInteger(position) || position < 1 || position > this.items.length) return null;
    const [removed] = this.items.splice(position - 1, 1);
    return removed ?? null;
  }

  /** Move a faixa de `from` para `to` (1-based sobre os próximos). Retorna a faixa movida. */
  move(from: number, to: number): Track | null {
    if (!this.isPosition(from) || !this.isPosition(to)) return null;
    const [moved] = this.items.splice(from - 1, 1);
    if (!moved) return null;
    this.items.splice(to - 1, 0, moved);
    return moved;
  }

  /**
   * Prepara a fila para pular direto para `position`, como `/skip` repetido: as faixas antes dela
   * saem da fila, exceto no loop de fila, em que vão para o fim depois da atual. Deve ser seguido
   * de `advance({ skip: true, drop: true })` (a atual já foi reposicionada aqui). Retorna quantas
   * faixas foram puladas, sem contar a atual.
   */
  prepareSkipTo(position: number): number | null {
    if (!this.isPosition(position)) return null;
    const skipped = this.items.slice(0, position - 1);
    const rest = this.items.slice(position - 1);
    this.items = this.loopMode === 'queue' ? [...rest, ...(this.current ? [this.current] : []), ...skipped] : rest;
    return skipped.length;
  }

  shuffle(): void {
    for (let i = this.items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const a = this.items[i];
      const b = this.items[j];
      if (a === undefined || b === undefined) continue;
      this.items[i] = b;
      this.items[j] = a;
    }
  }

  private isPosition(position: number): boolean {
    return Number.isInteger(position) && position >= 1 && position <= this.items.length;
  }

  clearUpcoming(): void {
    this.items = [];
  }

  reset(): void {
    this.items = [];
    this.current = null;
    this.loopMode = 'off';
  }
}
