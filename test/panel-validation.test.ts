import { describe, expect, it } from 'vitest';
import { buildMessage, describeDiscordError } from '../src/panel/discord.js';
import { allowedMentionsFor, validateAction, validateMessage } from '../src/panel/validation.js';

const CHANNEL = '123456789012345678';
const ok = (body: unknown) => {
  const result = validateMessage(body);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
const error = (body: unknown) => {
  const result = validateMessage(body);
  return result.ok ? null : result.error;
};

describe('validateMessage', () => {
  it('texto simples: sem menções por padrão', () => {
    expect(ok({ channelId: CHANNEL, content: 'oi' })).toEqual({
      channelId: CHANNEL,
      content: 'oi',
      embed: null,
      replyTo: null,
      allowMentions: false,
    });
  });

  it('limite de 2000 caracteres, inclusive', () => {
    expect(ok({ channelId: CHANNEL, content: 'x'.repeat(2000) }).content).toHaveLength(2000);
    expect(error({ channelId: CHANNEL, content: 'x'.repeat(2001) })).toBe('A mensagem passa de 2000 caracteres (2001).');
  });

  it('precisa de canal válido e de texto ou embed', () => {
    expect(error({ content: 'oi' })).toBe('Escolha um canal de texto.');
    expect(error({ channelId: 'abc', content: 'oi' })).toBe('Escolha um canal de texto.');
    expect(error({ channelId: CHANNEL, content: '   ' })).toBe('Escreva uma mensagem ou preencha o embed.');
    expect(error(null)).toBe('Corpo da requisição inválido.');
    expect(error({ channelId: CHANNEL, content: 5 })).toBe('Mensagem deve ser texto.');
  });

  it('embed: título/descrição com limites, cor #rrggbb', () => {
    expect(ok({ channelId: CHANNEL, embed: { title: ' Aviso ', description: '', color: '#00ff88' } }).embed).toEqual({
      title: 'Aviso',
      description: null,
      color: 0x00ff88,
    });
    expect(error({ channelId: CHANNEL, embed: { title: '', description: '' } })).toBe('O embed precisa de título ou descrição.');
    expect(error({ channelId: CHANNEL, embed: { title: 'x'.repeat(257) } })).toBe('Título do embed passa de 256 caracteres.');
    expect(error({ channelId: CHANNEL, embed: { description: 'x'.repeat(4097) } })).toBe('Descrição do embed passa de 4096 caracteres.');
    expect(error({ channelId: CHANNEL, embed: { title: 'a', color: 'red' } })).toBe('Cor do embed deve estar no formato #rrggbb.');
  });

  it('resposta por ID e opção de menções', () => {
    expect(ok({ channelId: CHANNEL, content: 'oi', replyTo: ' 223456789012345678 ', allowMentions: true })).toMatchObject({
      replyTo: '223456789012345678',
      allowMentions: true,
    });
    expect(error({ channelId: CHANNEL, content: 'oi', replyTo: 'abc' })).toBe('ID da mensagem para responder é inválido.');
    expect(error({ channelId: CHANNEL, content: 'oi', allowMentions: 'sim' })).toBe('Opção de menções inválida.');
  });
});

describe('menções', () => {
  it('padrão: nada notifica; liberado: só usuários e cargos; @everyone/@here nunca', () => {
    expect(allowedMentionsFor(false)).toEqual({ parse: [], repliedUser: false });
    expect(allowedMentionsFor(true)).toEqual({ parse: ['users', 'roles'], repliedUser: true });
  });

  it('@everyone digitado no texto não vira menção, mesmo com menções liberadas', () => {
    for (const allow of [false, true]) {
      const options = buildMessage(ok({ channelId: CHANNEL, content: '@everyone @here <@&1> <@2>', allowMentions: allow }));
      expect(options.allowedMentions?.parse ?? []).not.toContain('everyone');
      expect(options.content).toBe('@everyone @here <@&1> <@2>');
    }
  });

  it('monta embed e resposta', () => {
    const options = buildMessage(
      ok({ channelId: CHANNEL, embed: { title: 'T', description: 'D', color: '#010203' }, replyTo: '223456789012345678' }),
    );
    expect(options.content).toBeUndefined();
    expect(options.embeds?.[0] && 'toJSON' in options.embeds[0] ? options.embeds[0].toJSON() : null).toEqual({
      title: 'T',
      description: 'D',
      color: 0x010203,
    });
    expect(options.reply).toEqual({ messageReference: '223456789012345678', failIfNotExists: true });
  });

  it('erro genérico vira texto legível', () => {
    expect(describeDiscordError(new Error('socket hang up'))).toBe('Falha ao enviar: socket hang up');
  });
});

describe('validateAction', () => {
  it.each([
    [{ type: 'skip' }, { type: 'skip' }],
    [{ type: 'volume', level: 40 }, { type: 'volume', level: 40 }],
    [{ type: 'loop', mode: 'queue' }, { type: 'loop', mode: 'queue' }],
    [{ type: 'seek', positionSec: 90.7 }, { type: 'seek', positionSec: 90 }],
    [{ type: 'autoplay', enabled: true }, { type: 'autoplay', enabled: true }],
    [{ type: 'filter', filter: '8d' }, { type: 'filter', filter: '8d' }],
    [{ type: 'add', query: '  daft punk ' }, { type: 'add', query: 'daft punk', mode: 'append' }],
    [{ type: 'add', query: 'x', mode: 'now' }, { type: 'add', query: 'x', mode: 'now' }],
    [{ type: 'remove', id: 'q1a' }, { type: 'remove', id: 'q1a' }],
    [{ type: 'move', id: 'q1', beforeId: null }, { type: 'move', id: 'q1', beforeId: null }],
    [{ type: 'move', id: 'q1', beforeId: 'q2' }, { type: 'move', id: 'q1', beforeId: 'q2' }],
    [
      { type: 'join', voiceChannelId: '123456789012345678', textChannelId: '223456789012345678' },
      { type: 'join', voiceChannelId: '123456789012345678', textChannelId: '223456789012345678' },
    ],
  ])('%j', (body, expected) => {
    expect(validateAction(body)).toEqual({ ok: true, value: expected });
  });

  it.each([
    [{ type: 'volume', level: 101 }, 'Volume deve ser um inteiro de 0 a 100.'],
    [{ type: 'volume', level: 1.5 }, 'Volume deve ser um inteiro de 0 a 100.'],
    [{ type: 'loop', mode: 'sempre' }, 'Modo de loop inválido.'],
    [{ type: 'seek', positionSec: -1 }, 'Posição inválida.'],
    [{ type: 'filter', filter: 'reverb' }, 'Filtro inválido.'],
    [{ type: 'add', query: '' }, 'Informe um link do YouTube ou o nome da música.'],
    [{ type: 'add', query: 'x'.repeat(501) }, 'Texto passa de 500 caracteres.'],
    [{ type: 'remove', id: 3 }, 'Item da fila inválido.'],
    [{ type: 'remove', id: 'DROP TABLE' }, 'Item da fila inválido.'],
    [{ type: 'move', id: 'q1', beforeId: 7 }, 'Item da fila inválido.'],
    [{ type: 'join', voiceChannelId: 'x', textChannelId: 'y' }, 'Escolha o canal de voz e o canal de texto.'],
    [{ type: 'explodir' }, 'Ação desconhecida: explodir.'],
    [{}, 'Ação inválida.'],
    ['skip', 'Ação inválida.'],
  ])('recusa %j', (body, message) => {
    expect(validateAction(body)).toEqual({ ok: false, error: message });
  });
});
