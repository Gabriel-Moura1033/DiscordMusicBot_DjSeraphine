/** Entrar num canal de voz escolhido (painel). Os slash commands entram pelo canal de quem pediu. */
import { ChannelType, PermissionFlagsBits, type Guild, type GuildTextBasedChannel, type VoiceBasedChannel } from 'discord.js';
import { VoiceConnectError } from '../player/GuildPlayer.js';
import type { PlayerManager } from '../player/PlayerManager.js';
import { audit } from './playback.js';
import type { Actor, ControlResult } from './types.js';

/** Permissões que o bot precisa num canal de voz (mesmas do /play). */
export const VOICE_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak];

export async function join(
  players: Pick<PlayerManager, 'get' | 'getOrCreate'>,
  actor: Actor,
  guild: Guild,
  voiceChannel: VoiceBasedChannel,
  textChannel: GuildTextBasedChannel,
): Promise<ControlResult> {
  if (voiceChannel.type === ChannelType.GuildStageVoice) return { ok: false, message: 'Canais de palco não são suportados.' };
  const existing = players.get(guild.id);
  if (existing) {
    if (existing.voiceChannelId === voiceChannel.id) {
      existing.textChannel = textChannel;
      return { ok: true, message: `Já estou em <#${voiceChannel.id}>; avisos agora vão para <#${textChannel.id}>.` };
    }
    return { ok: false, message: `Já estou em <#${existing.voiceChannelId ?? ''}>. Saia de lá primeiro.` };
  }
  const me = guild.members.me;
  if (!me || !voiceChannel.permissionsFor(me).has(VOICE_PERMISSIONS)) {
    return { ok: false, message: `Não tenho permissão para entrar e falar em <#${voiceChannel.id}>.` };
  }
  if (!voiceChannel.joinable) return { ok: false, message: `Não consigo entrar em <#${voiceChannel.id}> (canal cheio?).` };

  try {
    const player = await players.getOrCreate(guild, voiceChannel, textChannel);
    player.textChannel = textChannel;
  } catch (error) {
    if (error instanceof VoiceConnectError) return { ok: false, message: `❌ ${error.message}` };
    throw error;
  }
  audit(actor, guild.id, 'join', { channelId: voiceChannel.id, textChannelId: textChannel.id });
  return { ok: true, message: `👋 Entrei em <#${voiceChannel.id}>.` };
}
