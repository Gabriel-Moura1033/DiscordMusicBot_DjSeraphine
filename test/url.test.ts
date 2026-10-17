import { describe, expect, it } from 'vitest';
import { parseInput, playlistUrl, videoUrl } from '../src/youtube/url.js';

const ID = 'dQw4w9WgXcQ';
const CANONICAL = `https://www.youtube.com/watch?v=${ID}`;
const LIST = 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI';

describe('parseInput — vídeos aceitos', () => {
  it.each([
    ['watch padrão', `https://www.youtube.com/watch?v=${ID}`],
    ['sem www', `https://youtube.com/watch?v=${ID}`],
    ['http', `http://www.youtube.com/watch?v=${ID}`],
    ['mobile', `https://m.youtube.com/watch?v=${ID}`],
    ['music.youtube.com', `https://music.youtube.com/watch?v=${ID}`],
    ['com timestamp e outros params', `https://www.youtube.com/watch?v=${ID}&t=42s&feature=share`],
    ['watch com list (toca só o vídeo)', `https://www.youtube.com/watch?v=${ID}&list=${LIST}&index=3`],
    ['music com mix', `https://music.youtube.com/watch?v=${ID}&list=RDAMVM${ID}`],
    ['youtu.be', `https://youtu.be/${ID}`],
    ['youtu.be com si', `https://youtu.be/${ID}?si=abcDEF123`],
    ['shorts', `https://www.youtube.com/shorts/${ID}`],
    ['shorts com query', `https://youtube.com/shorts/${ID}?feature=share`],
    ['live', `https://www.youtube.com/live/${ID}?si=x`],
    ['embed', `https://www.youtube.com/embed/${ID}`],
    ['/v/', `https://www.youtube.com/v/${ID}`],
    ['sem esquema (youtu.be)', `youtu.be/${ID}`],
    ['sem esquema (www)', `www.youtube.com/watch?v=${ID}`],
    ['host em maiúsculas', `https://WWW.YOUTUBE.COM/watch?v=${ID}`],
    ['espaços nas pontas', `   https://youtu.be/${ID}   `],
  ])('%s', (_label, input) => {
    expect(parseInput(input)).toEqual({ kind: 'video', videoId: ID, url: CANONICAL });
  });

  it('preserva maiúsculas, hífen e underscore do ID', () => {
    expect(parseInput('https://youtu.be/aB-_9zZ0xY1')).toMatchObject({ kind: 'video', videoId: 'aB-_9zZ0xY1' });
  });
});

describe('parseInput — playlists aceitas', () => {
  it.each([
    ['playlist', `https://www.youtube.com/playlist?list=${LIST}`],
    ['playlist no music', `https://music.youtube.com/playlist?list=${LIST}`],
    ['watch só com list', `https://www.youtube.com/watch?list=${LIST}`],
    ['watch com v inválido cai na list', `https://www.youtube.com/watch?v=curto&list=${LIST}`],
    ['sem esquema', `youtube.com/playlist?list=${LIST}`],
  ])('%s', (_label, input) => {
    expect(parseInput(input)).toEqual({ kind: 'playlist', playlistId: LIST, url: playlistUrl(LIST) });
  });
});

describe('parseInput — buscas', () => {
  it.each([
    ['texto simples', 'never gonna give you up', 'never gonna give you up'],
    ['apara espaços', '   rick astley  ', 'rick astley'],
    ['barra sem domínio', 'AC/DC thunderstruck', 'AC/DC thunderstruck'],
    ['domínio sem caminho', 'youtube.com', 'youtube.com'],
    ['exatamente 200 caracteres', 'a'.repeat(200), 'a'.repeat(200)],
  ])('%s', (_label, input, query) => {
    expect(parseInput(input)).toEqual({ kind: 'search', query });
  });
});

describe('parseInput — rejeitados', () => {
  it.each([
    ['Spotify', 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', 'open.spotify.com'],
    ['SoundCloud', 'https://soundcloud.com/artista/musica', 'soundcloud.com'],
    ['host parecido', `https://www.youtube.com.evil.example/watch?v=${ID}`, 'youtube.com.evil.example'],
    ['outro domínio', `https://notyoutube.com/watch?v=${ID}`, 'notyoutube.com'],
    ['sem esquema de outro site', 'open.spotify.com/track/abc', 'open.spotify.com'],
  ])('%s cita o host', (_label, input, host) => {
    const result = parseInput(input);
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') expect(result.reason).toContain(host);
  });

  it.each([
    ['canal', 'https://www.youtube.com/@canal'],
    ['canal legado', 'https://www.youtube.com/channel/UC38IQsAvIsxxjztdMZQtwHA'],
    ['ID curto', 'https://www.youtube.com/watch?v=curto'],
    ['ID longo', `https://www.youtube.com/watch?v=${ID}X`],
    ['watch sem v nem list', 'https://www.youtube.com/watch'],
    ['youtu.be sem ID', 'https://youtu.be/'],
    ['shorts sem ID', 'https://www.youtube.com/shorts/'],
    ['playlist sem list', 'https://www.youtube.com/playlist'],
    ['list com caractere inválido', 'https://www.youtube.com/playlist?list=PL$abc'],
    ['raiz do site', 'https://www.youtube.com/'],
    ['esquema ftp', `ftp://www.youtube.com/watch?v=${ID}`],
    ['vazio', ''],
    ['só espaços', '    '],
    ['busca longa demais', 'a'.repeat(201)],
  ])('%s', (_label, input) => {
    expect(parseInput(input).kind).toBe('rejected');
  });
});

describe('helpers de URL canônica', () => {
  it('videoUrl e playlistUrl', () => {
    expect(videoUrl(ID)).toBe(CANONICAL);
    expect(playlistUrl(LIST)).toBe(`https://www.youtube.com/playlist?list=${LIST}`);
  });
});
