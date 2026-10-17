import type { Track } from '../youtube/YouTubeService.js';

/** Faixas que tocaram, da mais recente para a mais antiga, com tamanho máximo. */
export class History {
  private items: Track[] = [];

  constructor(private readonly maxSize: number) {}

  get entries(): readonly Track[] {
    return this.items;
  }

  get size(): number {
    return this.items.length;
  }

  /** Repetições seguidas da mesma faixa (loop de faixa) contam uma vez só. */
  push(track: Track): void {
    if (this.items[0]?.id === track.id) return;
    this.items.unshift(track);
    if (this.items.length > this.maxSize) this.items.length = this.maxSize;
  }

  /** Retira a mais recente (usado pelo /previous: voltar duas vezes volta duas faixas). */
  pop(): Track | null {
    return this.items.shift() ?? null;
  }

  clear(): void {
    this.items = [];
  }
}
