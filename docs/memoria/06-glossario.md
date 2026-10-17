# 06 — Glossário e convenções

## Termos
- **Track** — faixa resolvida (`id`, `url`, `title`, `durationSec`, `requestedBy`). URL sempre canônica `https://www.youtube.com/watch?v=ID`.
- **Queue** — fila pura de uma guild: `current`, `upcoming[]`, `loopMode`.
- **LoopMode** — `off` | `track` | `queue`.
- **GuildPlayer** — dono da conexão de voz, AudioPlayer, fila e timers de uma guild.
- **PlayerManager** — registro `Map<guildId, GuildPlayer>`.
- **ActiveStream** — pipeline em execução (`resource`, `kill()`, `failure()`).
- **ParsedInput** — saída de `parseInput()`: `video` | `playlist` | `search` | `rejected`.
- **YtError** — erro tipado do yt-dlp; `code`: `private` | `unavailable` | `age_restricted` | `geo_blocked` | `bot_check` | `live` | `too_long` | `not_found` | `unknown`.
- **Guard** — pré-condição de canal de voz: `none` | `voice-join` (/play) | `same-channel` (demais).

## Convenções de código
- TypeScript strict, ESM (`"type": "module"`, imports com `.js`), sem `any`.
- Arquivos de classe em PascalCase (`GuildPlayer.ts`); módulos utilitários em camelCase/kebab (`url.ts`, `format.ts`).
- Um arquivo por comando em `src/commands/`, exportando `default` do tipo `Command`.
- Mensagens ao usuário em português; logs em inglês com campos estruturados (`guildId`, `trackId`).
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `build:`).

## Variáveis de ambiente
| Variável | Obrigatória | Padrão | Uso |
|---|---|---|---|
| `DISCORD_TOKEN` | sim | — | token do bot |
| `DISCORD_CLIENT_ID` | sim | — | application id (registro de comandos) |
| `DISCORD_GUILD_ID` | sim | — | guild onde os comandos são registrados |
| `MAX_PLAYLIST_SIZE` | não | 100 | máximo de itens importados por playlist |
| `MAX_TRACK_DURATION_SECONDS` | não | 7200 | duração máxima por vídeo |
| `IDLE_TIMEOUT_SECONDS` | não | 300 | sozinho no canal / fila vazia até desconectar |
| `DEFAULT_VOLUME` | não | 50 | volume inicial (0–100) |
| `YTDLP_PATH` | não | `yt-dlp` | binário do yt-dlp |
| `FFMPEG_PATH` | não | `ffmpeg` | binário do ffmpeg |
| `YTDLP_AUTO_UPDATE` | não | `true` | `yt-dlp -U` no entrypoint do container |
| `LOG_LEVEL` | não | `info` | nível do pino |
| `NODE_ENV` | não | — | `production` desativa pino-pretty |
