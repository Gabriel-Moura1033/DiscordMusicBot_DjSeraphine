/** Referência do fluxo do /play (Fase 7a): resposta (embed/texto), botões e efeito no player. */
import type { InteractionEditReplyOptions } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { executePlay, type PlayMode, type PlayRequest } from '../src/commands/playFlow.js';
import type { Services } from '../src/commands/types.js';
import { VoiceConnectError } from '../src/player/GuildPlayer.js';
import { YtError } from '../src/youtube/errors.js';
import type { ResolvableInput } from '../src/youtube/url.js';
import type { ResolveResult } from '../src/youtube/YouTubeService.js';
import { FakePlayer, GUILD_ID, track, VOICE_ID } from './support/fakes.js';

interface Outcome {
  readonly content: string | undefined;
  readonly embed: Record<string, unknown> | undefined;
  readonly buttons: number;
  readonly attached: string[];
}

async function play(
  options: {
    readonly player: FakePlayer;
    readonly input: PlayRequest['input'];
    readonly mode?: PlayMode;
    readonly resolve?: () => Promise<ResolveResult>;
    readonly connect?: () => Promise<FakePlayer>;
    readonly voiceChannelId?: string;
  },
): Promise<Outcome> {
  const attached: string[] = [];
  const responses: InteractionEditReplyOptions[] = [];
  const services = {
    config: { maxPlaylistSize: 100 },
    youtube: { resolve: vi.fn(options.resolve ?? (() => Promise.reject(new Error('resolve não esperado')))) },
    players: { getOrCreate: vi.fn(options.connect ?? (() => Promise.resolve(options.player))) },
    panels: { attach: (_g: string, t: { id: string }) => attached.push(t.id) },
  } as unknown as Services;
  await executePlay({
    services,
    guild: { id: GUILD_ID } as PlayRequest['guild'],
    member: { id: '42', displayName: 'Alice' } as PlayRequest['member'],
    target: { voiceChannel: { id: options.voiceChannelId ?? VOICE_ID }, textChannel: { id: 'txt' } } as PlayRequest['target'],
    input: options.input,
    mode: options.mode ?? 'append',
    respond: (payload) => {
      responses.push(payload);
      return Promise.resolve({ id: 'msg1', channel: { id: 'txt' } } as Awaited<ReturnType<PlayRequest['respond']>>);
    },
  });
  expect(responses).toHaveLength(1);
  const [response] = responses;
  const embed = response?.embeds?.[0];
  const rows = response?.components ?? [];
  return {
    content: typeof response?.content === 'string' ? response.content : undefined,
    embed: embed && 'toJSON' in embed ? (embed.toJSON() as unknown as Record<string, unknown>) : undefined,
    buttons: rows.length,
    attached,
  };
}

const video: ResolvableInput = { kind: 'video', videoId: 'A', url: 'https://www.youtube.com/watch?v=A' };
const search: ResolvableInput = { kind: 'search', query: 'faixa a' };
const single = (id: string) => () => Promise.resolve<ResolveResult>({ kind: 'single', track: track(id), fromSearch: false });

describe('executePlay', () => {
  it('começa a tocar: embed "Adicionado", posição tocando agora, botões e painel anexado', async () => {
    const player = new FakePlayer();
    const out = await play({ player, input: video, resolve: single('A') });
    expect(out.content).toBe('');
    expect(out.embed).toMatchObject({
      author: { name: '➕ Adicionado à fila' },
      title: 'Faixa A',
      url: 'https://www.youtube.com/watch?v=A',
      fields: [
        { name: 'Duração', value: '3:20', inline: true },
        { name: 'Canal', value: 'desconhecido', inline: true },
        { name: 'Posição', value: '▶️ Tocando agora', inline: true },
      ],
    });
    expect(out.buttons).toBe(1);
    expect(out.attached).toEqual(['A']);
    expect(player.queue.current?.requestedBy).toEqual({ id: '42', name: 'Alice' });
  });

  it('entra na fila: posição #n, sem botões; busca mostra a consulta', async () => {
    const player = new FakePlayer(track('X'), [track('Y')]);
    const out = await play({ player, input: search, resolve: single('A') });
    expect(out.embed).toMatchObject({
      author: { name: '🔎 Resultado da busca' },
      description: 'Busca: `faixa a`\nhttps://www.youtube.com/watch?v=A',
      fields: [{}, {}, { name: 'Posição', value: '#2' }],
    });
    expect(out.buttons).toBe(0);
    expect(out.attached).toEqual([]);
  });

  it('playnow interrompe a atual', async () => {
    const player = new FakePlayer(track('X'), [track('Y')]);
    const out = await play({ player, input: video, mode: 'now', resolve: single('A') });
    expect(out.embed).toMatchObject({ author: { name: '⏭️ Pulei "Faixa X" — tocando agora' } });
    expect(out.attached).toEqual(['A']);
    expect(player.queue.upcoming.map((t) => t.id)).toEqual(['Y']);
  });

  it('playlist com faixas ignoradas e truncada', async () => {
    const player = new FakePlayer();
    const out = await play({
      player,
      input: { kind: 'playlist', playlistId: 'PL1', url: 'https://www.youtube.com/playlist?list=PL1' },
      resolve: () =>
        Promise.resolve({
          kind: 'playlist',
          title: 'Minha lista',
          url: 'https://www.youtube.com/playlist?list=PL1',
          tracks: [track('A'), track('B')],
          skipped: 3,
          truncated: true,
        }),
    });
    expect(out.embed).toMatchObject({
      author: { name: '📃 Playlist adicionada' },
      title: 'Minha lista',
      url: 'https://www.youtube.com/playlist?list=PL1',
      description:
        '**2** faixas adicionadas.\n3 ignoradas (privadas, removidas, ao vivo ou longas demais).\nA playlist foi limitada às primeiras 100 faixas.',
    });
    expect(player.queue.upcoming.map((t) => t.id)).toEqual(['B']);
  });

  it('playlist salva não passa pelo YouTube', async () => {
    const player = new FakePlayer();
    const out = await play({ player, input: { kind: 'saved', name: 'Rock', tracks: [track('A'), track('B')] } });
    expect(out.embed).toMatchObject({ title: '📁 Rock', description: '**2** faixas adicionadas.' });
    expect(out.embed?.['url']).toBeUndefined();
  });

  it('fila restaurada vira rodapé', async () => {
    const player = new FakePlayer();
    player.restoredCount = 7;
    const out = await play({ player, input: video, resolve: single('A') });
    expect(out.embed).toMatchObject({
      footer: { text: '📂 Fila anterior com 7 faixa(s) restaurada (depois desta) — use /clear para descartar.' },
    });
  });

  it('erros: YouTube, conexão de voz e bot em outro canal', async () => {
    const player = new FakePlayer();
    expect((await play({ player, input: video, resolve: () => Promise.reject(new YtError('private')) })).content).toBe(
      '❌ O vídeo é privado ou exclusivo para membros.',
    );
    expect(
      (
        await play({
          player,
          input: video,
          resolve: single('A'),
          connect: () => Promise.reject(new VoiceConnectError('Não consegui conectar ao canal de voz (tempo esgotado).')),
        })
      ).content,
    ).toBe('❌ Não consegui conectar ao canal de voz (tempo esgotado).');
    expect((await play({ player, input: video, resolve: single('A'), voiceChannelId: 'outro' })).content).toBe(
      `Já estou tocando em <#${VOICE_ID}>. Entre lá para pedir músicas.`,
    );
  });
});
