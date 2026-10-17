import { ChannelType, PermissionFlagsBits } from 'discord.js';
import type { Command, GuildInteraction, JoinContext, PlayerContext, Services } from './types.js';

export type GuardResult<T> = { readonly ok: true; readonly ctx: T } | { readonly ok: false; readonly message: string };

function fail(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

export function resolveJoinContext(interaction: GuildInteraction, services: Services): GuardResult<JoinContext> {
  const voiceChannel = interaction.member.voice.channel;
  if (!voiceChannel) return fail('🔇 Entre em um canal de voz primeiro.');
  if (voiceChannel.type === ChannelType.GuildStageVoice) return fail('Canais de palco não são suportados.');

  const textChannel = interaction.channel;
  if (!textChannel) return fail('Use este comando em um canal de texto do servidor.');

  const player = services.players.get(interaction.guildId);
  if (player && player.voiceChannelId !== voiceChannel.id) {
    return fail(`Já estou tocando em <#${player.voiceChannelId ?? ''}>. Entre lá para pedir músicas.`);
  }

  const me = interaction.guild.members.me;
  const permissions = me ? voiceChannel.permissionsFor(me) : null;
  if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
    return fail(`Não tenho permissão para entrar e falar em <#${voiceChannel.id}>.`);
  }
  if (!player && !voiceChannel.joinable) return fail(`Não consigo entrar em <#${voiceChannel.id}> (canal cheio?).`);

  return { ok: true, ctx: { interaction, services, voiceChannel, textChannel } };
}

export function resolvePlayerContext(
  interaction: GuildInteraction,
  services: Services,
  requireSameChannel: boolean,
): GuardResult<PlayerContext> {
  const player = services.players.get(interaction.guildId);
  if (!player || player.isDestroyed) return fail('Não estou em nenhum canal de voz.');
  if (requireSameChannel && interaction.member.voice.channelId !== player.voiceChannelId) {
    return fail(`Você precisa estar no mesmo canal de voz que eu (<#${player.voiceChannelId ?? ''}>).`);
  }
  return { ok: true, ctx: { interaction, services, player } };
}

export async function runGuarded(command: Command, interaction: GuildInteraction, services: Services): Promise<string | null> {
  if (command.guard === 'voice-join') {
    const result = resolveJoinContext(interaction, services);
    if (!result.ok) return result.message;
    await command.execute(result.ctx);
    return null;
  }
  const result = resolvePlayerContext(interaction, services, command.guard === 'same-channel');
  if (!result.ok) return result.message;
  await command.execute(result.ctx);
  return null;
}
