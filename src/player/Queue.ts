import type { Track } from '../youtube/YouTubeService.js';

export type LoopMode = 'off' | 'track' | 'queue';

export interface AdvanceOptions {
  /** Ignora o loop de faixa (usado por /skip e em falhas). */
  readonly skip: boolean;
  /** Não devolve a faixa atual ao fim da fila no loop de fila (usado por /stop e em falhas). */
  readonly drop: boolean;
}

/** Item da fila com ID estável: o painel opera por ID, nunca por posição (ADR-044). */
export interface QueueEntry {
  readonly id: string;
  readonly track: Track;
}

let nextEntryId = 0;

function entry(track: Track): QueueEntry {
  nextEntryId++;
  return { id: `q${nextEntryId.toString(36)}`, track };
}

export class Queue {
  loopMode: LoopMode = 'off';
  private currentEntry: QueueEntry | null = null;
  private items: QueueEntry[] = [];

  get current(): Track | null {
    return this.currentEntry?.track ?? null;
  }

  /** ID do item que está tocando (`null` = nada). */
  get currentId(): string | null {
    return this.currentEntry?.id ?? null;
  }

  get upcoming(): readonly Track[] {
    return this.items.map((item) => item.track);
  }

  get entries(): readonly QueueEntry[] {
    return this.items;
  }

  get size(): number {
    return this.items.length;
  }

  /** Posição 1-based do item `id` entre os próximos; `null` = não está mais na fila. */
  positionOf(id: string): number | null {
    const index = this.items.findIndex((item) => item.id === id);
    return index === -1 ? null : index + 1;
  }

  /** Soma das durações conhecidas dos próximos itens; `unknown` conta os sem duração. */
  get upcomingDuration(): { readonly seconds: number; readonly unknown: number } {
    let seconds = 0;
    let unknown = 0;
    for (const { track } of this.items) {
      if (track.durationSec === null) unknown++;
      else seconds += track.durationSec;
    }
    return { seconds, unknown };
  }

  add(tracks: readonly Track[]): void {
    this.items.push(...tracks.map(entry));
  }

  /** Insere no início dos próximos, mantendo a ordem de `tracks`. */
  addFront(tracks: readonly Track[]): void {
    this.items.unshift(...tracks.map(entry));
  }

  /** Define e retorna a próxima faixa atual (ou `null` se acabou). */
  advance(options: AdvanceOptions): Track | null {
    const previous = this.currentEntry;
    if (previous && this.loopMode === 'track' && !options.skip) return previous.track;
    // A faixa que volta ao fim no loop de fila ganha ID novo: é outro item da fila.
    if (previous && this.loopMode === 'queue' && !options.drop) this.items.push(entry(previous.track));
    this.currentEntry = this.items.shift() ?? null;
    return this.current;
  }

  /** A faixa que `advance({ skip: false, drop: false })` tocaria a seguir (para pré-carga). */
  peekNext(): Track | null {
    const current = this.current;
    if (!current) return this.items[0]?.track ?? null;
    if (this.loopMode === 'track') return current;
    return this.items[0]?.track ?? (this.loopMode === 'queue' ? current : null);
  }

  /** `position` é 1-based sobre os próximos itens (1 = a próxima faixa). */
  remove(position: number): Track | null {
    if (!this.isPosition(position)) return null;
    const [removed] = this.items.splice(position - 1, 1);
    return removed?.track ?? null;
  }

  /** Move a faixa de `from` para `to` (1-based sobre os próximos). Retorna a faixa movida. */
  move(from: number, to: number): Track | null {
    if (!this.isPosition(from) || !this.isPosition(to)) return null;
    const [moved] = this.items.splice(from - 1, 1);
    if (!moved) return null;
    this.items.splice(to - 1, 0, moved);
    return moved.track;
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
    const current = this.currentEntry ? [entry(this.currentEntry.track)] : [];
    this.items = this.loopMode === 'queue' ? [...rest, ...current, ...skipped] : rest;
    return skipped.length;
  }

  /** Remove os próximos que satisfazem `predicate`; retorna quantos saíram. */
  removeWhere(predicate: (track: Track) => boolean): number {
    const before = this.items.length;
    this.items = this.items.filter((item) => !predicate(item.track));
    return before - this.items.length;
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
    this.currentEntry = null;
    this.loopMode = 'off';
  }
}
