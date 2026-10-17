/** Partes do painel que falam com o Discord: canais disponíveis e envio de mensagem como o bot. */
import {
  ChannelType,
  DiscordAPIError,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type GuildBasedChannel,
  type MessageCreateOptions,
} from 'discord.js';
import { EMBED_COLOR } from '../commands/embeds.js';
import { VOICE_PERMISSIONS } from '../control/session.js';
import { logger } from '../logger.js';
import { allowedMentionsFor, type SendMessageInput } from './validation.js';

const TEXT_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];

export interface ChannelView {
  readonly id: string;
  readonly name: string;
}

function allowed(guild: Guild, channel: GuildBasedChannel, permissions: readonly bigint[]): boolean {
  const me = guild.members.me;
  return me !== null && channel.permissionsFor(me).has([...permissions]);
}

function sorted(channels: GuildBasedChannel[]): ChannelView[] {
  return channels
    .sort((a, b) => ('rawPosition' in a ? a.rawPosition : 0) - ('rawPosition' in b ? b.rawPosition : 0))
    .map((channel) => ({ id: channel.id, name: channel.name }));
}

/** Só canais onde o bot pode agir: texto com View + Send; voz (sem palco) com View + Connect + Speak. */
export function listChannels(guild: Guild): { readonly text: ChannelView[]; readonly voice: ChannelView[] } {
  const all = [...guild.channels.cache.values()];
  return {
    text: sorted(
      all.filter(
        (channel) =>
          (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) &&
          allowed(guild, channel, TEXT_PERMISSIONS),
      ),
    ),
    voice: sorted(all.filter((channel) => channel.type === ChannelType.GuildVoice && allowed(guild, channel, VOICE_PERMISSIONS))),
  };
}

export type SendResult = { readonly ok: true; readonly url: string; readonly messageId: string } | { readonly ok: false; readonly error: string };

/** Erro do Discord em português, sem detalhes internos. */
export function describeDiscordError(error: unknown): string {
  if (error instanceof DiscordAPIError) {
    switch (error.code) {
      case 10003:
        return 'Canal não encontrado.';
      case 10008:
        return 'A mensagem que você quer responder não existe nesse canal.';
      case 50001:
        return 'O bot não tem acesso a esse canal.';
      case 50013:
        return 'O bot não tem permissão para isso nesse canal.';
      case 50035:
        return `O Discord recusou o conteúdo: ${error.message}`;
      default:
        return `Erro do Discord (${String(error.code)}): ${error.message}`;
    }
  }
  return `Falha ao enviar: ${error instanceof Error ? error.message : String(error)}`;
}

export function buildMessage(input: SendMessageInput): MessageCreateOptions {
  const options: MessageCreateOptions = { allowedMentions: allowedMentionsFor(input.allowMentions) };
  if (input.content !== null) options.content = input.content;
  if (input.embed) {
    const embed = new EmbedBuilder().setColor(input.embed.color ?? EMBED_COLOR);
    if (input.embed.title) embed.setTitle(input.embed.title);
    if (input.embed.description) embed.setDescription(input.embed.description);
    options.embeds = [embed];
  }
  if (input.replyTo) options.reply = { messageReference: input.replyTo, failIfNotExists: true };
  return options;
}

export async function sendMessage(guild: Guild, input: SendMessageInput): Promise<SendResult> {
  const channel = guild.channels.cache.get(input.channelId);
  if (
    !channel ||
    (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) ||
    !allowed(guild, channel, TEXT_PERMISSIONS)
  ) {
    return { ok: false, error: 'Canal não encontrado ou o bot não pode enviar mensagens nele.' };
  }
  try {
    const message = await channel.send(buildMessage(input));
    // Auditoria sem o conteúdo: só o tamanho e onde foi parar.
    logger.info(
      {
        audit: true,
        source: 'painel',
        action: 'message',
        guildId: guild.id,
        channelId: channel.id,
        messageId: message.id,
        length: input.content?.length ?? 0,
        embed: input.embed !== null,
        reply: input.replyTo !== null,
        mentions: input.allowMentions,
      },
      'panel message sent',
    );
    return { ok: true, url: message.url, messageId: message.id };
  } catch (error) {
    logger.warn({ err: error, guildId: guild.id, channelId: channel.id }, 'panel message failed');
    return { ok: false, error: describeDiscordError(error) };
  }
}
