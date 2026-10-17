import { ChannelType, PermissionFlagsBits, type Guild, type GuildMember, type GuildTextBasedChannel } from 'discord.js';
import type { GuildPlayer } from '../player/GuildPlayer.js';
import type { Command, GuildInteraction, Services, VoiceTarget } from './types.js';

export type GuardResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

/** O que os guards precisam de uma interação; slash commands, botões e menus em guild satisfazem. */
export interface GuildRequester {
  readonly guild: Guild;
  readonly guildId: string;
  readonly member: GuildMember;
  readonly channel: GuildTextBasedChannel | null;
}

function fail(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

/** Usuário em canal de voz (no do bot, se ele já estiver conectado) e bot com permissão de entrar. */
export function checkJoin(requester: GuildRequester, services: Services): GuardResult<VoiceTarget> {
  const voiceChannel = requester.member.voice.channel;
  if (!voiceChannel) return fail('🔇 Entre em um canal de voz primeiro.');
  if (voiceChannel.type === ChannelType.GuildStageVoice) return fail('Canais de palco não são suportados.');

  const textChannel = requester.channel;
  if (!textChannel) return fail('Use este comando em um canal de texto do servidor.');

  const player = services.players.get(requester.guildId);
  if (player && player.voiceChannelId !== voiceChannel.id) {
    return fail(`Já estou tocando em <#${player.voiceChannelId ?? ''}>. Entre lá para pedir músicas.`);
  }

  const me = requester.guild.members.me;
  const permissions = me ? voiceChannel.permissionsFor(me) : null;
  if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
    return fail(`Não tenho permissão para entrar e falar em <#${voiceChannel.id}>.`);
  }
  if (!player && !voiceChannel.joinable) return fail(`Não consigo entrar em <#${voiceChannel.id}> (canal cheio?).`);

  return { ok: true, value: { voiceChannel, textChannel } };
}

export function checkPlayer(
  requester: GuildRequester,
  services: Services,
  requireSameChannel: boolean,
): GuardResult<GuildPlayer> {
  const player = services.players.get(requester.guildId);
  if (!player || player.isDestroyed) return fail('Não estou em nenhum canal de voz.');
  if (requireSameChannel && requester.member.voice.channelId !== player.voiceChannelId) {
    return fail(`Você precisa estar no mesmo canal de voz que eu (<#${player.voiceChannelId ?? ''}>).`);
  }
  return { ok: true, value: player };
}

export async function runGuarded(command: Command, interaction: GuildInteraction, services: Services): Promise<string | null> {
  if (command.guard === 'voice-join') {
    const result = checkJoin(interaction, services);
    if (!result.ok) return result.message;
    await command.execute({ interaction, services, ...result.value });
    return null;
  }
  const result = checkPlayer(interaction, services, command.guard === 'same-channel');
  if (!result.ok) return result.message;
  await command.execute({ interaction, services, player: result.value });
  return null;
}
