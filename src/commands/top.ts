import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import type { TopScope } from '../db/repositories.js';
import { trackLink } from '../util/format.js';
import { baseEmbed } from './embeds.js';
import { deny } from './reply.js';
import type { Command } from './types.js';

const TOP_LIMIT = 10;
const DAY_MS = 86_400_000;

const PERIODS = {
  '7d': { label: 'últimos 7 dias', days: 7 },
  '30d': { label: 'últimos 30 dias', days: 30 },
  sempre: { label: 'desde sempre', days: null },
} as const;
type Period = keyof typeof PERIODS;

function isPeriod(value: string): value is Period {
  return value in PERIODS;
}

/** Início do período em ms (0 = sem limite). */
export function periodStart(period: Period, now: number): number {
  const days = PERIODS[period].days;
  return days === null ? 0 : now - days * DAY_MS;
}

const command: Command = {
  guard: 'none',
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('Músicas mais tocadas')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName('escopo')
        .setDescription('De quem (padrão: servidor)')
        .addChoices({ name: 'servidor', value: 'servidor' }, { name: 'só as que eu pedi', value: 'eu' }),
    )
    .addStringOption((option) =>
      option
        .setName('periodo')
        .setDescription('Período (padrão: 30 dias)')
        .addChoices({ name: '7 dias', value: '7d' }, { name: '30 dias', value: '30d' }, { name: 'sempre', value: 'sempre' }),
    ),

  async execute({ interaction, services }) {
    const scopeOption = interaction.options.getString('escopo') ?? 'servidor';
    const periodOption = interaction.options.getString('periodo') ?? '30d';
    if (!isPeriod(periodOption)) throw new Error(`invalid period: ${periodOption}`);

    const scope: TopScope = scopeOption === 'eu' ? { kind: 'user', userId: interaction.user.id } : { kind: 'guild' };
    const entries = services.store.plays.top(interaction.guildId, scope, periodStart(periodOption, Date.now()), TOP_LIMIT);
    const who = scope.kind === 'user' ? `pedidas por ${interaction.member.displayName}` : 'do servidor';
    if (entries.length === 0) {
      const when = periodOption === 'sempre' ? 'até agora' : `nos ${PERIODS[periodOption].label}`;
      await deny(interaction, `Nenhuma música ${who} tocou ${when}.`);
      return;
    }

    const lines = entries.map(
      (entry, index) => `\`${String(index + 1).padStart(2)}.\` ${trackLink(entry.track, 70)} — **${entry.plays}×**`,
    );
    const embed = baseEmbed()
      .setTitle(`🏆 Mais tocadas ${who}`)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${PERIODS[periodOption].label} · conta faixas ouvidas por 30 s ou até o fim; recomendações da DJ não entram` });
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

export default command;
