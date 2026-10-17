import { MessageFlags } from 'discord.js';
import { vi } from 'vitest';
import type { FilterName } from '../../src/audio/filters.js';
import type { SeekResult } from '../../src/player/GuildPlayer.js';
import { Queue, type LoopMode } from '../../src/player/Queue.js';
import type { Track } from '../../src/youtube/YouTubeService.js';

export const GUILD_ID = '123456789012345678';
export const VOICE_ID = '223456789012345678';

export function track(id: string, durationSec: number | null = 200): Track {
  return {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title: `Faixa ${id}`,
    durationSec,
    uploader: null,
    requestedBy: { id: '1', name: 'tester' },
  };
}

/**
 * Player falso com a mesma interface pública que os comandos usam do GuildPlayer, sobre uma Queue
 * real. Os resultados assíncronos (seek/filtro) e as respostas de previous/skipTo são configuráveis.
 */
export class FakePlayer {
  readonly guildId = GUILD_ID;
  readonly voiceChannelId = VOICE_ID;
  readonly queue = new Queue();
  isPaused = false;
  volume = 50;
  filter: FilterName = 'nenhum';
  autoplay = false;
  isDestroyed = false;
  seekResult: SeekResult = { status: 'ok' };
  previousResult: Track | 'busy' | null = null;
  restoredCount = 0;
  readonly calls: string[] = [];

  constructor(current: Track | null = null, upcoming: readonly Track[] = []) {
    if (current) {
      this.queue.add([current, ...upcoming]);
      this.queue.advance({ skip: false, drop: false });
    } else {
      this.queue.add(upcoming);
    }
  }

  get loopMode(): LoopMode {
    return this.queue.loopMode;
  }

  pause(): boolean {
    this.calls.push('pause');
    if (!this.queue.current || this.isPaused) return false;
    this.isPaused = true;
    return true;
  }

  resume(): boolean {
    this.calls.push('resume');
    if (!this.isPaused) return false;
    this.isPaused = false;
    return true;
  }

  skip(): Track | null {
    this.calls.push('skip');
    const current = this.queue.current;
    if (!current) return null;
    this.queue.advance({ skip: true, drop: false });
    return current;
  }

  skipTo(position: number): { readonly track: Track; readonly skipped: number } | 'busy' | null {
    this.calls.push(`skipTo:${position}`);
    if (!this.queue.current) return null;
    const target = this.queue.upcoming[position - 1];
    const skipped = this.queue.prepareSkipTo(position);
    if (!target || skipped === null) return null;
    this.queue.advance({ skip: true, drop: true });
    return { track: target, skipped };
  }

  previous(): Track | 'busy' | null {
    this.calls.push('previous');
    return this.previousResult;
  }

  stop(): void {
    this.calls.push('stop');
    this.queue.clearUpcoming();
    this.queue.loopMode = 'off';
    this.queue.current = null;
  }

  destroy(reason: string, options: { readonly discardQueue?: boolean } = {}): void {
    this.calls.push(`destroy:${reason}:${options.discardQueue === true}`);
    this.isDestroyed = true;
  }

  setVolume(percent: number): void {
    this.calls.push(`volume:${percent}`);
    this.volume = percent;
  }

  setLoop(mode: LoopMode): void {
    this.calls.push(`loop:${mode}`);
    this.queue.loopMode = mode;
  }

  setAutoplay(enabled: boolean): number {
    this.calls.push(`autoplay:${enabled}`);
    this.autoplay = enabled;
    return enabled ? 0 : this.queue.removeWhere((t) => t.autoplayFrom !== undefined);
  }

  seek(positionSec: number): Promise<SeekResult> {
    this.calls.push(`seek:${positionSec}`);
    return Promise.resolve(this.seekResult);
  }

  setFilter(filter: FilterName): Promise<SeekResult> {
    this.calls.push(`filter:${filter}`);
    this.filter = filter;
    return Promise.resolve(this.queue.current ? this.seekResult : { status: 'idle' });
  }

  textChannel: unknown = null;

  enqueue(tracks: readonly Track[]): number {
    this.calls.push(`enqueue:${tracks.map((t) => t.id).join(',')}`);
    const startNow = this.queue.current === null;
    const position = startNow ? 0 : this.queue.size + 1;
    this.queue.add(tracks);
    if (startNow) this.queue.advance({ skip: false, drop: false });
    return position;
  }

  playNow(tracks: readonly Track[]): Track | null {
    this.calls.push(`playNow:${tracks.map((t) => t.id).join(',')}`);
    const current = this.queue.current;
    if (!current) {
      this.enqueue(tracks);
      return null;
    }
    this.queue.addFront(tracks);
    this.queue.advance({ skip: true, drop: false });
    return current;
  }

  consumeRestoredCount(): number {
    const count = this.restoredCount;
    this.restoredCount = 0;
    return count;
  }
}

export type ReplyKind = 'say' | 'deny' | 'defer' | 'edit' | 'followUp';

export interface RecordedReply {
  readonly kind: ReplyKind;
  readonly content?: string | undefined;
}

function contentOf(options: unknown): string | undefined {
  if (typeof options === 'string') return options;
  if (typeof options === 'object' && options !== null && 'content' in options) {
    const content = (options as { content?: unknown }).content;
    return typeof content === 'string' ? content : undefined;
  }
  return undefined;
}

function isEphemeral(options: unknown): boolean {
  if (typeof options !== 'object' || options === null || !('flags' in options)) return false;
  const flags = (options as { flags?: unknown }).flags;
  return typeof flags === 'number' && (flags & MessageFlags.Ephemeral) !== 0;
}

/** Interação de slash command falsa: guarda cada resposta com o tipo e o texto. */
export function fakeInteraction(options: Record<string, string | number> = {}) {
  const replies: RecordedReply[] = [];
  const option = (name: string): string | number => {
    const value = options[name];
    if (value === undefined) throw new Error(`opção ${name} não informada no teste`);
    return value;
  };
  const interaction = {
    deferred: false,
    replied: false,
    guildId: GUILD_ID,
    user: { id: '42' },
    member: { displayName: 'Alice' },
    options: {
      getInteger: (name: string) => Number(option(name)),
      getString: (name: string) => String(option(name)),
    },
    reply: vi.fn((payload: unknown) => {
      interaction.replied = true;
      replies.push({ kind: isEphemeral(payload) ? 'deny' : 'say', content: contentOf(payload) });
      return Promise.resolve({});
    }),
    deferReply: vi.fn(() => {
      interaction.deferred = true;
      replies.push({ kind: 'defer' });
      return Promise.resolve({});
    }),
    editReply: vi.fn((payload: unknown) => {
      replies.push({ kind: 'edit', content: contentOf(payload) });
      return Promise.resolve({});
    }),
    followUp: vi.fn((payload: unknown) => {
      replies.push({ kind: isEphemeral(payload) ? 'deny' : 'followUp', content: contentOf(payload) });
      return Promise.resolve({});
    }),
  };
  return { interaction, replies };
}
