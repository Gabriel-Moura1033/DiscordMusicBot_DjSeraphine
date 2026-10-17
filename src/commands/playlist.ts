import { InteractionContextType, MessageFlags, SlashCommandBuilder, type SlashCommandStringOption } from 'discord.js';
import { logger } from '../logger.js';
import { formatDuration, truncate } from '../util/format.js';
import { baseEmbed } from './embeds.js';
import { checkJoin } from './guards.js';
import { executePlay } from './playFlow.js';
import { deny } from './reply.js';
import type { BaseContext, Command } from './types.js';

export const PLAYLIST_NAME_MAX = 50;
const AUTOCOMPLETE_LIMIT = 25;

/** Nome limpo (espaços colapsados, sem caracteres de controle) ou `null` se inválido. */
export function normalizePlaylistName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length === 0 || name.length > PLAYLIST_NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

/** Respostas do /playlist são pessoais (só quem usou vê), exceto o carregar, que mexe na fila de todos. */
async function reply(ctx: BaseContext, content: string): Promise<void> {
  await ctx.interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

function nameOption(ctx: BaseContext): string | null {
  return normalizePlaylistName(ctx.interaction.options.getString('nome', true));
}

const INVALID_NAME = `Nome inválido: use de 1 a ${PLAYLIST_NAME_MAX} caracteres.`;

async function save(ctx: BaseContext): Promise<void> {
  const { interaction, services } = ctx;
  const name = nameOption(ctx);
  if (!name) return reply(ctx, INVALID_NAME);

  const player = services.players.get(interaction.guildId);
  const queue = player?.queueSnapshot() ?? [];
  if (queue.length === 0) return reply(ctx, 'Não há nada tocando nem na fila para salvar.');

  const max = services.config.maxPlaylistSize;
  const tracks = queue.slice(0, max);
  const result = services.store.playlists.save(interaction.user.id, name, tracks);
  if (result === 'limit') {
    return reply(ctx, `Você já tem ${services.config.playlistsPerUser} playlists (o máximo). Apague uma com \`/playlist apagar\`.`);
  }
  const verb = result === 'replaced' ? 'substituída' : 'salva';
  const cut = queue.length > max ? ` (limitada às primeiras ${max})` : '';
  await reply(ctx, `💾 Playlist **${name}** ${verb} com ${tracks.length} faixa(s)${cut}: a atual e a fila.`);
}

async function load(ctx: BaseContext): Promise<void> {
  const { interaction, services } = ctx;
  const name = nameOption(ctx);
  if (!name) return reply(ctx, INVALID_NAME);

  const playlist = services.store.playlists.get(interaction.user.id, name);
  if (!playlist) return reply(ctx, `Você não tem uma playlist chamada **${name}**. Veja \`/playlist listar\`.`);
  // O limite de duração pode ter mudado desde que a playlist foi salva.
  const tracks = playlist.tracks.filter(
    (track) => track.durationSec === null || track.durationSec <= services.config.maxTrackDurationSec,
  );
  if (tracks.length === 0) return reply(ctx, `A playlist **${playlist.name}** não tem faixas que possam tocar.`);

  const joined = checkJoin(interaction, services);
  if (!joined.ok) return reply(ctx, joined.message);

  await interaction.deferReply();
  await executePlay({
    services,
    guild: interaction.guild,
    member: interaction.member,
    target: joined.value,
    input: { kind: 'saved', name: playlist.name, tracks },
    mode: 'append',
    respond: (options) => interaction.editReply(options),
  });
}

async function list(ctx: BaseContext): Promise<void> {
  const { interaction, services } = ctx;
  const playlists = services.store.playlists.list(interaction.user.id);
  if (playlists.length === 0) return reply(ctx, 'Você ainda não tem playlists. Use `/playlist salvar` com algo tocando.');
  const lines = playlists.map(
    (playlist) =>
      `📁 **${truncate(playlist.name, PLAYLIST_NAME_MAX)}** — ${playlist.count} faixa(s), ${formatDuration(playlist.durationSec)}`,
  );
  const embed = baseEmbed()
    .setTitle('Suas playlists')
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${playlists.length}/${services.config.playlistsPerUser} · valem em qualquer servidor com este bot` });
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function remove(ctx: BaseContext): Promise<void> {
  const name = nameOption(ctx);
  if (!name) return reply(ctx, INVALID_NAME);
  const deleted = ctx.services.store.playlists.delete(ctx.interaction.user.id, name);
  await reply(ctx, deleted ? `🗑️ Playlist **${name}** apagada.` : `Você não tem uma playlist chamada **${name}**.`);
}

const nameField = (description: string) => (option: SlashCommandStringOption) =>
  option.setName('nome').setDescription(description).setRequired(true).setMaxLength(PLAYLIST_NAME_MAX).setAutocomplete(true);

const command: Command = {
  guard: 'none',
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Suas playlists salvas')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub.setName('salvar').setDescription('Salva a faixa atual + a fila (substitui se o nome existir)').addStringOption(nameField('Nome da playlist')),
    )
    .addSubcommand((sub) =>
      sub.setName('carregar').setDescription('Coloca uma playlist sua na fila').addStringOption(nameField('Qual playlist')),
    )
    .addSubcommand((sub) => sub.setName('listar').setDescription('Mostra suas playlists'))
    .addSubcommand((sub) =>
      sub.setName('apagar').setDescription('Apaga uma playlist sua').addStringOption(nameField('Qual playlist')),
    ),

  async autocomplete(interaction, services) {
    let choices: { name: string; value: string }[] = [];
    try {
      choices = services.store.playlists
        .names(interaction.user.id, interaction.options.getFocused(), AUTOCOMPLETE_LIMIT)
        .map((name) => ({ name, value: name }));
    } catch (error) {
      logger.warn({ err: error }, 'playlist autocomplete failed');
    }
    await interaction.respond(choices).catch((error: unknown) => logger.debug({ err: error }, 'autocomplete response failed'));
  },

  async execute(ctx) {
    const sub = ctx.interaction.options.getSubcommand(true);
    if (sub === 'salvar') return save(ctx);
    if (sub === 'carregar') return load(ctx);
    if (sub === 'listar') return list(ctx);
    if (sub === 'apagar') return remove(ctx);
    await deny(ctx.interaction, 'Subcomando desconhecido.');
  },
};

export default command;
