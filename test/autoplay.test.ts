import { describe, expect, it } from 'vitest';
import { buildAvoid, pickAutoplayCandidate, queueEndAction, RecentTracks, titleKey } from '../src/player/autoplay.js';
import { Queue } from '../src/player/Queue.js';
import type { Track, TrackInfo } from '../src/youtube/YouTubeService.js';
import { playableEntries } from '../src/youtube/YouTubeService.js';

function info(id: string, title: string, durationSec: number | null = 240): TrackInfo {
  return { id, url: `https://www.youtube.com/watch?v=${id}`, title, durationSec, uploader: null };
}

function track(id: string, title = `Faixa ${id}`, autoplayFrom?: string): Track {
  return {
    ...info(id, title),
    requestedBy: { id: '1', name: 'tester' },
    ...(autoplayFrom !== undefined ? { autoplayFrom } : {}),
  };
}

describe('titleKey', () => {
  it.each([
    ['Queen – Bohemian Rhapsody (Official Video Remastered)', 'queen bohemian rhapsody'],
    ['Queen - Bohemian Rhapsody [Lyrics]', 'queen bohemian rhapsody'],
    ['QUEEN — Bohemian Rhapsody (Live Aid 1985)', 'queen bohemian rhapsody'],
    ['Legião Urbana - Tempo Perdido (Ao Vivo Especial)', 'legiao urbana tempo perdido'],
    ['Legião Urbana · Tempo perdido', 'legiao urbana tempo perdido'],
    ['Legião Urbana - Tempo perdido (Videoclipe)', 'legiao urbana tempo perdido'],
    ['Daft Punk - Get Lucky ft. Pharrell Williams (Official Audio)', 'daft punk get lucky'],
    ['Radiohead - Creep (Lyrics)', 'radiohead creep'],
  ])('%s → %s', (title, key) => {
    expect(titleKey(title)).toBe(key);
  });

  it('músicas diferentes do mesmo artista continuam diferentes', () => {
    expect(titleKey("Queen - Don't Stop Me Now (Official Video Remastered 4K)")).not.toBe(
      titleKey('Queen - Somebody To Love (Official Video)'),
    );
  });
});

describe('pickAutoplayCandidate', () => {
  // Ordem real do mix de "Bohemian Rhapsody" (2026-10-17): o 1º é a própria semente.
  const mix = [
    info('fJ9rUzIMcZQ', 'Queen – Bohemian Rhapsody (Official Video Remastered)', 360),
    info('HgzGwKwLmgM', "Queen - Don't Stop Me Now (Official Video Remastered 4K)", 215),
    info('kijpcUv-b8M', 'Queen - Somebody To Love (Official Video)', 310),
    info('1w7OgIMMRc4', "Guns N' Roses - Sweet Child O' Mine (Official Music Video)", 303),
  ];
  const seed = track('fJ9rUzIMcZQ', 'Queen – Bohemian Rhapsody (Official Video Remastered)');

  it('pula a própria semente e pega o próximo da ordem de relevância', () => {
    expect(pickAutoplayCandidate(mix, buildAvoid([seed]), 7200)?.id).toBe('HgzGwKwLmgM');
  });

  it('evita faixas já tocadas, na fila ou recentes', () => {
    const avoid = buildAvoid([seed, track('HgzGwKwLmgM', 'x'), track('kijpcUv-b8M', 'y')]);
    expect(pickAutoplayCandidate(mix, avoid, 7200)?.id).toBe('1w7OgIMMRc4');
  });

  it('evita outra versão da mesma música (id diferente, título equivalente)', () => {
    const candidates = [info('aaaaaaaaaaa', 'Queen - Bohemian Rhapsody [Lyrics]'), ...mix.slice(1)];
    expect(pickAutoplayCandidate(candidates, buildAvoid([seed]), 7200)?.id).toBe('HgzGwKwLmgM');
  });

  it('respeita o limite de duração e ignora itens sem duração', () => {
    const candidates = [info('bbbbbbbbbbb', 'Longa', 9000), info('ccccccccccc', 'Live?', null), info('ddddddddddd', 'Ok', 200)];
    expect(pickAutoplayCandidate(candidates, buildAvoid([]), 7200)?.id).toBe('ddddddddddd');
  });

  it('nada elegível → null', () => {
    expect(pickAutoplayCandidate(mix, buildAvoid(mix), 7200)).toBeNull();
    expect(pickAutoplayCandidate([], buildAvoid([]), 7200)).toBeNull();
  });
});

describe('queueEndAction', () => {
  const base = { enabled: true, stopped: false, seedId: 'A', pendingSeedId: null, failedSeedId: null };

  it('autoplay desligado, /stop ou sem semente → timer de inatividade normal', () => {
    expect(queueEndAction({ ...base, enabled: false })).toBe('idle');
    expect(queueEndAction({ ...base, stopped: true })).toBe('idle');
    expect(queueEndAction({ ...base, seedId: null })).toBe('idle');
  });

  it('busca antecipada em andamento para a mesma semente → espera, sem timer', () => {
    expect(queueEndAction({ ...base, pendingSeedId: 'A' })).toBe('wait');
  });

  it('busca em andamento de outra semente não conta', () => {
    expect(queueEndAction({ ...base, pendingSeedId: 'B' })).toBe('fetch');
  });

  it('semente que já falhou → avisa e arma o timer', () => {
    expect(queueEndAction({ ...base, failedSeedId: 'A' })).toBe('exhausted');
  });

  it('caso normal → busca agora', () => {
    expect(queueEndAction(base)).toBe('fetch');
  });
});

describe('RecentTracks', () => {
  it('mais recente primeiro, até o limite', () => {
    const recent = new RecentTracks<Track>(2);
    recent.push(track('A'));
    recent.push(track('B'));
    recent.push(track('C'));
    expect(recent.entries.map((t) => t.id)).toEqual(['C', 'B']);
  });
});

describe('Queue.removeWhere', () => {
  it('tira só as faixas do autoplay e preserva a ordem do resto', () => {
    const queue = new Queue();
    queue.add([track('A'), track('B', 'b', 'semente'), track('C'), track('D', 'd', 'semente')]);
    expect(queue.removeWhere((t) => t.autoplayFrom !== undefined)).toBe(2);
    expect(queue.upcoming.map((t) => t.id)).toEqual(['A', 'C']);
  });
});

describe('playableEntries (JSON do mix)', () => {
  it('converte entradas e descarta lives, privados, IDs inválidos e longos demais', () => {
    const json = {
      title: 'Mix - Queen',
      entries: [
        { id: 'fJ9rUzIMcZQ', title: 'Bohemian Rhapsody', duration: 360, channel: 'Queen Official' },
        { id: 'HgzGwKwLmgM', title: 'Live agora', duration: null, live_status: 'is_live' },
        { id: 'kijpcUv-b8M', title: '[Private video]', duration: null },
        { id: 'curto', title: 'ID inválido', duration: 100 },
        { id: '1w7OgIMMRc4', title: 'Longa', duration: 8000 },
        { id: '6NXnxTNIWkc', title: "What's Up", duration: 293, uploader: '4 Non Blondes' },
      ],
    };
    expect(playableEntries(json, 7200)).toEqual([
      {
        id: 'fJ9rUzIMcZQ',
        url: 'https://www.youtube.com/watch?v=fJ9rUzIMcZQ',
        title: 'Bohemian Rhapsody',
        durationSec: 360,
        uploader: 'Queen Official',
      },
      {
        id: '6NXnxTNIWkc',
        url: 'https://www.youtube.com/watch?v=6NXnxTNIWkc',
        title: "What's Up",
        durationSec: 293,
        uploader: '4 Non Blondes',
      },
    ]);
  });

  it('sem entries → lista vazia', () => {
    expect(playableEntries({ title: 'x' }, 7200)).toEqual([]);
  });
});
