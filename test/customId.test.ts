import { describe, expect, it } from 'vitest';
import { CONTROL_ACTIONS, controlId, parseControlId, parseSearchId, searchId } from '../src/interactions/customId.js';

const GUILD = '123456789012345678';
const USER = '876543210987654321';

describe('customId de controle', () => {
  it.each(CONTROL_ACTIONS)('ida e volta: %s', (action) => {
    const id = controlId(action, GUILD);
    expect(id).toBe(`ctl:${action}:${GUILD}`);
    expect(parseControlId(id)).toEqual({ action, guildId: GUILD });
  });

  it.each([
    'ctl:explode:123456789012345678',
    'ctl:skip:abc',
    'ctl:skip',
    `ctl:skip:${GUILD}:extra`,
    `srch:${GUILD}:${USER}:1`,
    `queue:${GUILD}:next`,
    '',
  ])('rejeita %j', (id) => {
    expect(parseControlId(id)).toBeNull();
  });
});

describe('customId de busca', () => {
  it('ida e volta', () => {
    const id = searchId(GUILD, USER, '1299999999999999999');
    expect(parseSearchId(id)).toEqual({ guildId: GUILD, userId: USER, nonce: '1299999999999999999' });
    expect(id.length).toBeLessThanOrEqual(100);
  });

  it.each([`srch:${GUILD}:x:1`, `srch:${GUILD}:${USER}`, `srch:${GUILD}:${USER}:a:b`, `ctl:skip:${GUILD}`])(
    'rejeita %j',
    (id) => {
      expect(parseSearchId(id)).toBeNull();
    },
  );
});
