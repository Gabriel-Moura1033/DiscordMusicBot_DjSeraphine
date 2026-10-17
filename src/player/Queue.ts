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

  clearUpcoming(): void {
    this.items = [];
  }

  reset(): void {
    this.items = [];
    this.current = null;
    this.loopMode = 'off';
  }
}
