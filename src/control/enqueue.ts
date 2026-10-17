/**
 * Pedido de música (resolve no YouTube, conecta, enfileira ou toca agora), compartilhado por
 * /play, /playnow, /search, /playlist carregar e o painel. A apresentação (embed, botões) fica com
 * quem chamou.
 */
import type { Guild, GuildTextBasedChannel, VoiceBasedChannel } from 'discord.js';
import { capitalize } from '../commands/reply.js';
import { VoiceConnectError, type GuildPlayer } from '../player/GuildPlayer.js';
import type { PlayerManager } from '../player/PlayerManager.js';
import { YtError } from '../youtube/errors.js';
import type { ResolvableInput } from '../youtube/url.js';
import type { ResolveResult, Track, TrackInfo, YouTubeService } from '../youtube/YouTubeService.js';
import { audit } from './playback.js';
import type { Actor } from './types.js';

export type PlayMode = 'append' | 'now';

/** Playlist salva (/playlist carregar): as faixas já estão resolvidas, não passam pelo yt-dlp. */
export interface SavedPlaylistInput {
  readonly kind: 'saved';
  readonly name: string;
  readonly tracks: readonly TrackInfo[];
}

export type PlayInput = ResolvableInput | SavedPlaylistInput;

export interface PlayDeps {
  readonly youtube: Pick<YouTubeService, 'resolve'>;
  readonly players: Pick<PlayerManager, 'getOrCreate'>;
}

export interface PlayOrder {
  readonly guild: Guild;
  readonly voiceChannel: VoiceBasedChannel;
  readonly textChannel: GuildTextBasedChannel;
  readonly input: PlayInput;
  readonly mode: PlayMode;
  /** Aparece em "pedido por" e no /top. */
  readonly requestedBy: { readonly id: string; readonly name: string };
  readonly actor: Actor;
}

export type PlayOutcome =
  | { readonly ok: false; readonly message: string }
  | {
      readonly ok: true;
      readonly player: GuildPlayer;
      readonly result: ResolveResult;
      readonly tracks: readonly Track[];
      /** 0 = começou a tocar agora. */
      readonly position: number;
      /** /playnow: faixa interrompida. */
      readonly interrupted: Track | null;
      /** Faixas da fila salva que voltaram junto (aviso de restauração). */
      readonly restored: number;
    };

/** Quem pede pelo painel aparece assim em "pedido por". */
export const PANEL_REQUESTER = { id: 'panel', name: 'Painel' } as const;

async function connect(deps: PlayDeps, order: PlayOrder): Promise<GuildPlayer | string> {
  try {
    const player = await deps.players.getOrCreate(order.guild, order.voiceChannel, order.textChannel);
    // Outro pedido pode ter conectado o bot em outro canal enquanto o yt-dlp resolvia.
    if (player.voiceChannelId !== order.voiceChannel.id) {
      return `Já estou tocando em <#${player.voiceChannelId ?? ''}>. Entre lá para pedir músicas.`;
    }
    player.textChannel = order.textChannel;
    return player;
  } catch (error) {
    if (error instanceof VoiceConnectError) return `❌ ${error.message}`;
    throw error;
  }
}

export async function requestPlay(deps: PlayDeps, order: PlayOrder): Promise<PlayOutcome> {
  const { input } = order;
  let result: ResolveResult;
  try {
    result =
      input.kind === 'saved'
        ? { kind: 'playlist', title: `📁 ${input.name}`, url: '', tracks: input.tracks, skipped: 0, truncated: false }
        : await deps.youtube.resolve(input);
  } catch (error) {
    if (error instanceof YtError) return { ok: false, message: `❌ ${capitalize(error.userMessage)}.` };
    throw error;
  }

  const player = await connect(deps, order);
  if (typeof player === 'string') return { ok: false, message: player };

  const withRequester = (info: TrackInfo): Track => ({ ...info, requestedBy: order.requestedBy });
  const tracks = result.kind === 'single' ? [withRequester(result.track)] : result.tracks.map(withRequester);

  let position: number;
  let interrupted: Track | null = null;
  if (order.mode === 'now') {
    interrupted = player.playNow(tracks);
    position = 0;
  } else {
    position = player.enqueue(tracks);
  }
  const restored = player.consumeRestoredCount();
  audit(order.actor, player.guildId, order.mode === 'now' ? 'playnow' : 'play', {
    input: input.kind,
    tracks: tracks.length,
    position,
    ...(restored > 0 ? { restored } : {}),
  });
  return { ok: true, player, result, tracks, position, interrupted, restored };
}
