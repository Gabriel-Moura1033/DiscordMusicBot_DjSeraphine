/** Validação dos corpos JSON das rotas do painel. Puro: entra `unknown`, sai valor tipado ou erro legível. */
import { isFilterName, type FilterName } from '../audio/filters.js';
import type { LoopMode } from '../player/Queue.js';

export type Validation<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

const SNOWFLAKE = /^\d{17,20}$/;
const QUEUE_ID = /^q[0-9a-z]{1,12}$/;
export const MESSAGE_MAX = 2000;
export const EMBED_TITLE_MAX = 256;
export const EMBED_DESCRIPTION_MAX = 4096;
const QUERY_MAX = 500;

function invalid<T>(error: string): Validation<T> {
  return { ok: false, error };
}

function record(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

export function isSnowflake(value: unknown): value is string {
  return typeof value === 'string' && SNOWFLAKE.test(value);
}

// ---------------------------------------------------------------------------- mensagens

export interface EmbedInput {
  readonly title: string | null;
  readonly description: string | null;
  readonly color: number | null;
}

export interface SendMessageInput {
  readonly channelId: string;
  readonly content: string | null;
  readonly embed: EmbedInput | null;
  readonly replyTo: string | null;
  readonly allowMentions: boolean;
}

/** Menções: nada por padrão; com a opção, só usuários e cargos. @everyone/@here nunca (ADR-047). */
export function allowedMentionsFor(allow: boolean): { parse: ('users' | 'roles')[]; repliedUser: boolean } {
  return allow ? { parse: ['users', 'roles'], repliedUser: true } : { parse: [], repliedUser: false };
}

function parseEmbed(value: unknown): Validation<EmbedInput | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  const embed = record(value);
  if (!embed) return invalid('Embed inválido.');
  const title = optionalString(embed['title']);
  const description = optionalString(embed['description']);
  if (title === undefined || description === undefined) return invalid('Título e descrição do embed devem ser texto.');
  const cleanTitle = title?.trim() || null;
  const cleanDescription = description?.trim() || null;
  if (!cleanTitle && !cleanDescription) return invalid('O embed precisa de título ou descrição.');
  if (cleanTitle && cleanTitle.length > EMBED_TITLE_MAX) return invalid(`Título do embed passa de ${EMBED_TITLE_MAX} caracteres.`);
  if (cleanDescription && cleanDescription.length > EMBED_DESCRIPTION_MAX) {
    return invalid(`Descrição do embed passa de ${EMBED_DESCRIPTION_MAX} caracteres.`);
  }
  const rawColor = optionalString(embed['color']);
  if (rawColor === undefined || (rawColor !== null && !/^#[0-9a-f]{6}$/i.test(rawColor))) {
    return invalid('Cor do embed deve estar no formato #rrggbb.');
  }
  const color = rawColor === null ? null : Number.parseInt(rawColor.slice(1), 16);
  return { ok: true, value: { title: cleanTitle, description: cleanDescription, color } };
}

export function validateMessage(body: unknown): Validation<SendMessageInput> {
  const input = record(body);
  if (!input) return invalid('Corpo da requisição inválido.');
  if (!isSnowflake(input['channelId'])) return invalid('Escolha um canal de texto.');

  const content = optionalString(input['content']);
  if (content === undefined) return invalid('Mensagem deve ser texto.');
  const text = content?.trim() ? content : null;
  if (text !== null && text.length > MESSAGE_MAX) return invalid(`A mensagem passa de ${MESSAGE_MAX} caracteres (${text.length}).`);

  const embed = parseEmbed(input['embed']);
  if (!embed.ok) return embed;
  if (text === null && embed.value === null) return invalid('Escreva uma mensagem ou preencha o embed.');

  const replyTo = optionalString(input['replyTo']);
  const reply = replyTo?.trim() || null;
  if (replyTo === undefined || (reply !== null && !isSnowflake(reply))) return invalid('ID da mensagem para responder é inválido.');

  const allowMentions = input['allowMentions'] ?? false;
  if (typeof allowMentions !== 'boolean') return invalid('Opção de menções inválida.');

  return { ok: true, value: { channelId: input['channelId'], content: text, embed: embed.value, replyTo: reply, allowMentions } };
}

// ---------------------------------------------------------------------------- controles

export type PanelAction =
  | { readonly type: 'pause' | 'resume' | 'skip' | 'stop' | 'leave' | 'shuffle' | 'previous' | 'replay' | 'clear' }
  | { readonly type: 'volume'; readonly level: number }
  | { readonly type: 'loop'; readonly mode: LoopMode }
  | { readonly type: 'seek'; readonly positionSec: number }
  | { readonly type: 'autoplay'; readonly enabled: boolean }
  | { readonly type: 'filter'; readonly filter: FilterName }
  | { readonly type: 'add'; readonly query: string; readonly mode: 'append' | 'now' }
  | { readonly type: 'remove' | 'skipto'; readonly id: string }
  | { readonly type: 'move'; readonly id: string; readonly beforeId: string | null }
  | { readonly type: 'join'; readonly voiceChannelId: string; readonly textChannelId: string };

const SIMPLE_ACTIONS = new Set(['pause', 'resume', 'skip', 'stop', 'leave', 'shuffle', 'previous', 'replay', 'clear'] as const);

function isSimple(type: string): type is 'pause' | 'resume' | 'skip' | 'stop' | 'leave' | 'shuffle' | 'previous' | 'replay' | 'clear' {
  return (SIMPLE_ACTIONS as ReadonlySet<string>).has(type);
}

function isQueueId(value: unknown): value is string {
  return typeof value === 'string' && QUEUE_ID.test(value);
}

export function validateAction(body: unknown): Validation<PanelAction> {
  const input = record(body);
  const type = input?.['type'];
  if (!input || typeof type !== 'string') return invalid('Ação inválida.');
  if (isSimple(type)) return { ok: true, value: { type } };

  switch (type) {
    case 'volume': {
      const level = input['level'];
      return typeof level === 'number' && Number.isInteger(level) && level >= 0 && level <= 100
        ? { ok: true, value: { type, level } }
        : invalid('Volume deve ser um inteiro de 0 a 100.');
    }
    case 'loop': {
      const mode = input['mode'];
      return mode === 'off' || mode === 'track' || mode === 'queue'
        ? { ok: true, value: { type, mode } }
        : invalid('Modo de loop inválido.');
    }
    case 'seek': {
      const position = input['positionSec'];
      return typeof position === 'number' && Number.isFinite(position) && position >= 0
        ? { ok: true, value: { type, positionSec: Math.floor(position) } }
        : invalid('Posição inválida.');
    }
    case 'autoplay': {
      const enabled = input['enabled'];
      return typeof enabled === 'boolean' ? { ok: true, value: { type, enabled } } : invalid('Valor de autoplay inválido.');
    }
    case 'filter': {
      const filter = input['filter'];
      return typeof filter === 'string' && isFilterName(filter) ? { ok: true, value: { type, filter } } : invalid('Filtro inválido.');
    }
    case 'add': {
      const query = input['query'];
      const mode = input['mode'] ?? 'append';
      if (typeof query !== 'string' || !query.trim()) return invalid('Informe um link do YouTube ou o nome da música.');
      if (query.length > QUERY_MAX) return invalid(`Texto passa de ${QUERY_MAX} caracteres.`);
      if (mode !== 'append' && mode !== 'now') return invalid('Modo inválido.');
      return { ok: true, value: { type, query: query.trim(), mode } };
    }
    case 'remove':
    case 'skipto':
      return isQueueId(input['id']) ? { ok: true, value: { type, id: input['id'] } } : invalid('Item da fila inválido.');
    case 'move': {
      const beforeId = input['beforeId'] ?? null;
      if (!isQueueId(input['id']) || (beforeId !== null && !isQueueId(beforeId))) return invalid('Item da fila inválido.');
      return { ok: true, value: { type, id: input['id'], beforeId } };
    }
    case 'join':
      return isSnowflake(input['voiceChannelId']) && isSnowflake(input['textChannelId'])
        ? { ok: true, value: { type, voiceChannelId: input['voiceChannelId'], textChannelId: input['textChannelId'] } }
        : invalid('Escolha o canal de voz e o canal de texto.');
    default:
      return invalid(`Ação desconhecida: ${type}.`);
  }
}
