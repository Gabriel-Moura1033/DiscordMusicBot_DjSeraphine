import type { FilterName } from '../audio/filters.js';
import type { SeekResult } from '../player/GuildPlayer.js';
import type { LoopMode, Queue } from '../player/Queue.js';
import type { Track } from '../youtube/YouTubeService.js';

/** Quem pediu a ação: vai para o log de auditoria e, no painel, para o aviso no canal. */
export type Actor =
  | { readonly source: 'discord'; readonly userId: string; readonly name: string }
  | { readonly source: 'painel' };

/**
 * Resultado de uma operação de controle. `message` é o texto mostrado ao usuário (mesmo para
 * slash command e painel). `ok: false` = recusado sem efeito (no Discord, resposta efêmera).
 */
export type ControlResult = { readonly ok: true; readonly message: string } | { readonly ok: false; readonly message: string };

export interface SlowHooks {
  /** Chamado antes de uma espera longa (reabrir stream); o slash command usa para o deferReply. */
  readonly beforeSlow?: () => Promise<void>;
}

/** O que a camada de controle usa do GuildPlayer (permite testar com um player falso). */
export interface ControllablePlayer {
  readonly guildId: string;
  readonly queue: Queue;
  readonly loopMode: LoopMode;
  readonly isPaused: boolean;
  readonly volume: number;
  readonly filter: FilterName;
  readonly autoplay: boolean;
  pause(): boolean;
  resume(): boolean;
  skip(): Track | null;
  skipTo(position: number): { readonly track: Track; readonly skipped: number } | 'busy' | null;
  previous(): Track | 'busy' | null;
  stop(): void;
  destroy(reason: string, options?: { readonly discardQueue?: boolean }): void;
  setVolume(percent: number): void;
  setLoop(mode: LoopMode): void;
  setAutoplay(enabled: boolean): number;
  seek(positionSec: number): Promise<SeekResult>;
  setFilter(filter: FilterName): Promise<SeekResult>;
  consumeRestoredCount(): number;
}
