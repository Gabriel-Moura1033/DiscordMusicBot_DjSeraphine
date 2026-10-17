/**
 * Testes de referência das respostas dos comandos de controle (Fase 7a): escritos contra o código
 * ANTES da refatoração para src/control/ e mantidos sem alteração depois. Provam que tipo de
 * resposta (pública/efêmera/adiada), texto e efeito na fila continuam idênticos.
 */
import { describe, expect, it } from 'vitest';
import autoplay from '../src/commands/autoplay.js';
import clear from '../src/commands/clear.js';
import filtro from '../src/commands/filtro.js';
import leave from '../src/commands/leave.js';
import loop from '../src/commands/loop.js';
import move from '../src/commands/move.js';
import pause from '../src/commands/pause.js';
import previous from '../src/commands/previous.js';
import remove from '../src/commands/remove.js';
import replay from '../src/commands/replay.js';
import resume from '../src/commands/resume.js';
import seek from '../src/commands/seek.js';
import shuffle from '../src/commands/shuffle.js';
import skip from '../src/commands/skip.js';
import skipto from '../src/commands/skipto.js';
import stop from '../src/commands/stop.js';
import type { Command, PlayerContext } from '../src/commands/types.js';
import volume from '../src/commands/volume.js';
import { YtError } from '../src/youtube/errors.js';
import { FakePlayer, fakeInteraction, track, type RecordedReply } from './support/fakes.js';

async function run(command: Command, player: FakePlayer, options: Record<string, string | number> = {}): Promise<RecordedReply[]> {
  const { interaction, replies } = fakeInteraction(options);
  if (command.guard !== 'same-channel') throw new Error('comando fora do escopo destes testes');
  await command.execute({ interaction, services: {}, player } as unknown as PlayerContext);
  return replies;
}

const link = (id: string) => `[Faixa ${id}](https://www.youtube.com/watch?v=${id})`;
const ids = (player: FakePlayer) => player.queue.upcoming.map((t) => t.id);
const playing = (...rest: string[]) => new FakePlayer(track('A'), rest.map((id) => track(id)));

describe('pause / resume', () => {
  it('pausa e retoma', async () => {
    const player = playing();
    expect(await run(pause, player)).toEqual([{ kind: 'say', content: '⏸️ Pausado. Use `/resume` para continuar.' }]);
    expect(await run(pause, player)).toEqual([{ kind: 'deny', content: 'Não há nada tocando (ou já está pausado).' }]);
    expect(await run(resume, player)).toEqual([{ kind: 'say', content: '▶️ Continuando.' }]);
    expect(await run(resume, player)).toEqual([{ kind: 'deny', content: 'Não há nada pausado.' }]);
  });
});

describe('skip / stop / leave', () => {
  it('skip', async () => {
    const player = playing('B');
    expect(await run(skip, player)).toEqual([{ kind: 'say', content: `⏭️ Pulei ${link('A')}.` }]);
    expect(player.queue.current?.id).toBe('B');
    expect(await run(skip, new FakePlayer())).toEqual([{ kind: 'deny', content: 'Não há nada tocando.' }]);
  });

  it('stop', async () => {
    const player = playing('B', 'C');
    expect(await run(stop, player)).toEqual([{ kind: 'say', content: '⏹️ Parei a música e limpei a fila.' }]);
    expect(player.queue.size).toBe(0);
    expect(player.calls).toEqual(['stop']);
  });

  it('leave descarta a fila salva', async () => {
    const player = playing('B');
    expect(await run(leave, player)).toEqual([{ kind: 'say', content: '👋 Saí do canal de voz.' }]);
    expect(player.calls).toEqual(['destroy:leave command:true']);
  });
});

describe('fila: clear, remove, move, shuffle, skipto', () => {
  it('clear', async () => {
    const player = playing('B', 'C');
    expect(await run(clear, player)).toEqual([{ kind: 'say', content: '🧹 Removi 2 faixa(s) da fila. A atual continua tocando.' }]);
    expect(player.queue.current?.id).toBe('A');
    expect(await run(clear, player)).toEqual([{ kind: 'deny', content: 'A fila já está vazia.' }]);
  });

  it('remove', async () => {
    const player = playing('B', 'C');
    expect(await run(remove, player, { posicao: 2 })).toEqual([{ kind: 'say', content: `🗑️ Removi ${link('C')} da posição #2.` }]);
    expect(ids(player)).toEqual(['B']);
    expect(await run(remove, player, { posicao: 5 })).toEqual([{ kind: 'deny', content: 'Posição inválida. A fila tem 1 faixa(s).' }]);
  });

  it('move', async () => {
    const player = playing('B', 'C', 'D');
    expect(await run(move, player, { de: 3, para: 1 })).toEqual([{ kind: 'say', content: `↕️ Movi ${link('D')} de #3 para #1.` }]);
    expect(ids(player)).toEqual(['D', 'B', 'C']);
    expect(await run(move, player, { de: 9, para: 1 })).toEqual([{ kind: 'deny', content: 'Posição inválida. A fila tem 3 faixa(s).' }]);
  });

  it('shuffle', async () => {
    expect(await run(shuffle, playing('B'))).toEqual([
      { kind: 'deny', content: 'Precisa de pelo menos 2 faixas na fila para embaralhar.' },
    ]);
    const player = playing('B', 'C', 'D');
    expect(await run(shuffle, player)).toEqual([{ kind: 'say', content: '🔀 Embaralhei 3 faixas.' }]);
    expect([...ids(player)].sort()).toEqual(['B', 'C', 'D']);
  });

  it('skipto sem loop e com loop de fila', async () => {
    const player = playing('B', 'C', 'D');
    expect(await run(skipto, player, { posicao: 3 })).toEqual([
      { kind: 'say', content: `⏩ Pulando para ${link('D')} (2 faixa(s) puladas saíram da fila).` },
    ]);
    const looping = playing('B', 'C');
    looping.queue.loopMode = 'queue';
    expect(await run(skipto, looping, { posicao: 2 })).toEqual([
      { kind: 'say', content: `⏩ Pulando para ${link('C')} (1 faixa(s) puladas foram para o fim da fila).` },
    ]);
    expect(await run(skipto, playing('B'), { posicao: 1 })).toEqual([{ kind: 'say', content: `⏩ Pulando para ${link('B')}.` }]);
  });

  it('skipto inválido, sem nada tocando e ocupado', async () => {
    expect(await run(skipto, playing('B'), { posicao: 4 })).toEqual([
      { kind: 'deny', content: 'Posição inválida. A fila tem 1 faixa(s).' },
    ]);
    expect(await run(skipto, new FakePlayer(), { posicao: 1 })).toEqual([
      { kind: 'deny', content: 'Posição inválida. Não há nada tocando.' },
    ]);
    const busy = playing('B');
    busy.skipTo = () => 'busy';
    expect(await run(skipto, busy, { posicao: 1 })).toEqual([
      { kind: 'deny', content: 'Estou trocando de faixa agora; tente de novo em instantes.' },
    ]);
  });
});

describe('previous', () => {
  it('volta, avisa fila restaurada, histórico vazio e ocupado', async () => {
    const player = playing();
    player.previousResult = track('Z');
    expect(await run(previous, player)).toEqual([{ kind: 'say', content: `⏮️ Voltando para ${link('Z')}.` }]);
    player.restoredCount = 4;
    expect(await run(previous, player)).toEqual([
      {
        kind: 'say',
        content: `⏮️ Voltando para ${link('Z')}.\n📂 Fila anterior com 4 faixa(s) restaurada — use /clear para descartar.`,
      },
    ]);
    player.previousResult = null;
    expect(await run(previous, player)).toEqual([{ kind: 'deny', content: 'Não há faixas anteriores no histórico.' }]);
    player.previousResult = 'busy';
    expect(await run(previous, player)).toEqual([
      { kind: 'deny', content: 'Estou trocando de faixa agora; tente de novo em instantes.' },
    ]);
  });
});

describe('seek / replay', () => {
  it('seek ok, inválido, além da duração e sem nada tocando', async () => {
    const player = playing();
    expect(await run(seek, player, { tempo: '1:30' })).toEqual([
      { kind: 'defer' },
      { kind: 'edit', content: `⏩ ${link('A')} em \`1:30\`.` },
    ]);
    expect(player.calls).toEqual(['seek:90']);
    expect(await run(seek, player, { tempo: '1:7' })).toEqual([
      { kind: 'deny', content: 'Tempo inválido: `1:7`. Use `mm:ss` ou `hh:mm:ss` (ex.: `1:30`).' },
    ]);
    expect(await run(seek, player, { tempo: '3:20' })).toEqual([
      { kind: 'deny', content: 'A faixa tem 3:20; escolha um ponto antes disso.' },
    ]);
    expect(await run(seek, new FakePlayer(), { tempo: '0:10' })).toEqual([{ kind: 'deny', content: 'Não há nada tocando.' }]);
  });

  it('seek com falha do stream e trocando de faixa', async () => {
    const player = playing();
    player.seekResult = { status: 'failed', error: new YtError('forbidden') };
    expect(await run(seek, player, { tempo: '10' })).toEqual([
      { kind: 'defer' },
      {
        kind: 'edit',
        content: '❌ Não consegui reabrir o áudio: o YouTube recusou o download do áudio (HTTP 403). A música continua de onde estava.',
      },
    ]);
    player.seekResult = { status: 'busy' };
    expect(await run(seek, player, { tempo: '10' })).toEqual([
      { kind: 'defer' },
      { kind: 'edit', content: 'Estou trocando de faixa agora; tente de novo em instantes.' },
    ]);
  });

  it('replay', async () => {
    const player = playing();
    expect(await run(replay, player)).toEqual([{ kind: 'defer' }, { kind: 'edit', content: `🔄 Recomeçando ${link('A')}.` }]);
    expect(player.calls).toEqual(['seek:0']);
    player.seekResult = { status: 'superseded' };
    expect(await run(replay, player)).toEqual([
      { kind: 'defer' },
      { kind: 'edit', content: 'A faixa mudou (ou outro pedido de posição chegou) antes de eu terminar.' },
    ]);
    expect(await run(replay, new FakePlayer())).toEqual([{ kind: 'deny', content: 'Não há nada tocando.' }]);
  });
});

describe('volume / loop / autoplay / filtro', () => {
  it('volume', async () => {
    const player = playing();
    expect(await run(volume, player, { nivel: 80 })).toEqual([{ kind: 'say', content: '🔊 Volume: **80%**.' }]);
    expect(await run(volume, player, { nivel: 0 })).toEqual([{ kind: 'say', content: '🔇 Volume: **0%**.' }]);
    expect(player.volume).toBe(0);
  });

  it('loop', async () => {
    const player = playing();
    expect(await run(loop, player, { modo: 'queue' })).toEqual([{ kind: 'say', content: 'Loop: **🔁 fila**.' }]);
    expect(await run(loop, player, { modo: 'off' })).toEqual([{ kind: 'say', content: 'Loop: **desligado**.' }]);
    expect(player.loopMode).toBe('off');
  });

  it('autoplay liga e desliga (tirando as faixas dele)', async () => {
    const player = new FakePlayer(track('A'), [track('B'), { ...track('C'), autoplayFrom: 'A' }]);
    expect(await run(autoplay, player)).toEqual([
      { kind: 'say', content: '🤖 Autoplay **ligado**: quando a fila acabar, sigo com músicas relacionadas à última que tocou.' },
    ]);
    expect(await run(autoplay, player)).toEqual([
      { kind: 'say', content: '🤖 Autoplay **desligado**. Tirei 1 faixa(s) que ele tinha colocado na fila.' },
    ]);
    expect(await run(autoplay, player)).toEqual([
      { kind: 'say', content: '🤖 Autoplay **ligado**: quando a fila acabar, sigo com músicas relacionadas à última que tocou.' },
    ]);
    expect(await run(autoplay, player)).toEqual([{ kind: 'say', content: '🤖 Autoplay **desligado**.' }]);
  });

  it('filtro: aplica, repetido, sem nada tocando e com falha', async () => {
    const player = playing();
    expect(await run(filtro, player, { tipo: 'nightcore' })).toEqual([
      { kind: 'defer' },
      { kind: 'edit', content: '🎛️ Filtro: **🐿️ nightcore**.' },
    ]);
    expect(await run(filtro, player, { tipo: 'nightcore' })).toEqual([
      { kind: 'deny', content: 'O filtro já é **🐿️ nightcore**.' },
    ]);
    expect(await run(filtro, new FakePlayer(), { tipo: '8d' })).toEqual([
      { kind: 'defer' },
      { kind: 'edit', content: '🎛️ Filtro **🎧 8D** salvo; vale a partir da próxima música.' },
    ]);
    player.seekResult = { status: 'failed', error: new YtError('timeout') };
    expect(await run(filtro, player, { tipo: 'bassboost' })).toEqual([
      { kind: 'defer' },
      {
        kind: 'edit',
        content:
          '❌ Não consegui reabrir o áudio: o YouTube demorou demais para responder. A música continua de onde estava. O filtro **🔊 bass boost** vale a partir da próxima música.',
      },
    ]);
  });
});
