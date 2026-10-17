import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { LogBuffer, makeScrubber, parseLogLine, REDACT_CENSOR, REDACT_PATHS } from '../src/logging.js';

const line = (fields: Record<string, unknown>) => JSON.stringify({ level: 30, time: 1, pid: 2, hostname: 'h', msg: 'm', ...fields });

describe('LogBuffer', () => {
  it('guarda só as últimas N, em ordem, com sequência crescente', () => {
    const buffer = new LogBuffer(3);
    for (let i = 1; i <= 5; i++) buffer.write(line({ msg: `m${i}` }));
    expect(buffer.entries().map((e) => e.msg)).toEqual(['m3', 'm4', 'm5']);
    expect(buffer.entries().map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  it('extrai nível, guild e campos (sem pid/hostname)', () => {
    const buffer = new LogBuffer(10);
    buffer.write(line({ level: 40, guildId: '123', trackId: 'abc', msg: 'oi' }));
    expect(buffer.entries()[0]).toEqual({ seq: 1, time: 1, level: 40, msg: 'oi', guildId: '123', fields: { guildId: '123', trackId: 'abc' } });
  });

  it('ignora linhas que não são objetos JSON', () => {
    const buffer = new LogBuffer(10);
    buffer.write('não é json');
    buffer.write('[1,2]');
    expect(buffer.entries()).toEqual([]);
    expect(parseLogLine('null', 1)).toBeNull();
  });

  it('assinantes recebem cada entrada; assinante quebrado não afeta os outros; cancelar funciona', () => {
    const buffer = new LogBuffer(10);
    const good = vi.fn();
    buffer.subscribe(() => {
      throw new Error('conexão caiu');
    });
    const unsubscribe = buffer.subscribe(good);
    buffer.write(line({ msg: 'a' }));
    unsubscribe();
    buffer.write(line({ msg: 'b' }));
    expect(good).toHaveBeenCalledTimes(1);
    expect(buffer.entries()).toHaveLength(2);
  });
});

describe('segredos fora dos logs', () => {
  it('o scrubber troca o valor literal dos tokens em qualquer lugar da linha', () => {
    const scrub = makeScrubber(['MTIz.discord-token-xyz', 'painel-token-0123456789abcdef', 'curto']);
    expect(scrub('{"msg":"falha com MTIz.discord-token-xyz e painel-token-0123456789abcdef"}')).toBe(
      `{"msg":"falha com ${REDACT_CENSOR} e ${REDACT_CENSOR}"}`,
    );
    // Segredos curtos demais não são usados (trocariam pedaços de texto comum).
    expect(scrub('curto')).toBe('curto');
  });

  it('o redact do pino cobre token, cookie, autorização e CSRF', () => {
    const lines: string[] = [];
    const log = pino({ redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR } }, { write: (l: string) => void lines.push(l) });
    log.info({
      token: 'a',
      config: { discordToken: 'b', panelToken: 'c' },
      headers: { authorization: 'Bearer d', cookie: 'dj_session=e' },
      session: 'f',
      csrf: 'g',
      ok: 'visível',
    });
    const record = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(record).toMatchObject({
      token: REDACT_CENSOR,
      config: { discordToken: REDACT_CENSOR, panelToken: REDACT_CENSOR },
      headers: { authorization: REDACT_CENSOR, cookie: REDACT_CENSOR },
      session: REDACT_CENSOR,
      csrf: REDACT_CENSOR,
      ok: 'visível',
    });
  });
});
