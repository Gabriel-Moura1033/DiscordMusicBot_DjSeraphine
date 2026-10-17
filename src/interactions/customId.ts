/**
 * Formato dos `customId` tratados pelo handler global (ADR-030). Tudo que o handler precisa
 * para agir está no ID, então um clique funciona mesmo depois de um restart.
 * - `ctl:<ação>:<guildId>`: botões de controle da faixa.
 * - `srch:<guildId>:<userId>:<nonce>`: menu de resultados do /search.
 */

export const CONTROL_ACTIONS = ['toggle', 'skip', 'loop', 'stop'] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

const SNOWFLAKE = /^\d{17,20}$/;

function isControlAction(value: string): value is ControlAction {
  return (CONTROL_ACTIONS as readonly string[]).includes(value);
}

export function controlId(action: ControlAction, guildId: string): string {
  return `ctl:${action}:${guildId}`;
}

export function parseControlId(customId: string): { readonly action: ControlAction; readonly guildId: string } | null {
  const [prefix, action, guildId, ...rest] = customId.split(':');
  if (prefix !== 'ctl' || rest.length > 0 || !action || !guildId) return null;
  if (!isControlAction(action) || !SNOWFLAKE.test(guildId)) return null;
  return { action, guildId };
}

export function searchId(guildId: string, userId: string, nonce: string): string {
  return `srch:${guildId}:${userId}:${nonce}`;
}

export function parseSearchId(
  customId: string,
): { readonly guildId: string; readonly userId: string; readonly nonce: string } | null {
  const [prefix, guildId, userId, nonce, ...rest] = customId.split(':');
  if (prefix !== 'srch' || rest.length > 0 || !guildId || !userId || !nonce) return null;
  if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(userId) || !/^\w{1,32}$/.test(nonce)) return null;
  return { guildId, userId, nonce };
}
