import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  GuildTextBasedChannel,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  VoiceBasedChannel,
} from 'discord.js';
import type { Config } from '../config.js';
import type { ControlPanels } from '../interactions/controls.js';
import type { SearchSessions } from '../interactions/searchSessions.js';
import type { SuggestionProvider } from '../interactions/suggestions.js';
import type { GuildPlayer } from '../player/GuildPlayer.js';
import type { PlayerManager } from '../player/PlayerManager.js';
import type { TrackInfo, YouTubeService } from '../youtube/YouTubeService.js';

export interface Services {
  readonly config: Config;
  readonly youtube: YouTubeService;
  readonly players: PlayerManager;
  readonly panels: ControlPanels;
  readonly searches: SearchSessions<TrackInfo>;
  /** `null` = autocomplete desligado (`AUTOCOMPLETE_ENABLED=false`). */
  readonly suggestions: SuggestionProvider | null;
}

export type GuildInteraction = ChatInputCommandInteraction<'cached'>;

export interface VoiceTarget {
  readonly voiceChannel: VoiceBasedChannel;
  readonly textChannel: GuildTextBasedChannel;
}

export interface JoinContext extends VoiceTarget {
  readonly interaction: GuildInteraction;
  readonly services: Services;
}

export interface PlayerContext {
  readonly interaction: GuildInteraction;
  readonly services: Services;
  readonly player: GuildPlayer;
}

interface CommandBase {
  readonly data: { readonly name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  autocomplete?(interaction: AutocompleteInteraction<'cached'>, services: Services): Promise<void>;
}

/**
 * - `voice-join`: usuário precisa estar em um canal de voz (e no do bot, se ele já estiver conectado).
 * - `same-channel`: bot conectado e usuário no mesmo canal — comandos que controlam o player.
 * - `active-player`: só exige o bot conectado — comandos de leitura (/queue, /nowplaying).
 */
export type Command =
  | (CommandBase & { readonly guard: 'voice-join'; execute(ctx: JoinContext): Promise<void> })
  | (CommandBase & { readonly guard: 'same-channel' | 'active-player'; execute(ctx: PlayerContext): Promise<void> });
