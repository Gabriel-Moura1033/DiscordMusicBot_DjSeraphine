# 06 — Glossário e convenções

## Termos
- **Track** — faixa resolvida (`id`, `url`, `title`, `durationSec`, `requestedBy`). URL sempre canônica `https://www.youtube.com/watch?v=ID`.
- **Queue** — fila pura de uma guild: `current`, `upcoming[]`, `loopMode`.
- **LoopMode** — `off` | `track` | `queue`.
- **GuildPlayer** — dono da conexão de voz, AudioPlayer, fila e timers de uma guild.
- **PlayerManager** — registro `Map<guildId, GuildPlayer>`.
- **ActiveStream** — pipeline em execução (`resource`, `kill()`, `failure(timeoutMs)`).
- **ParsedInput** — saída de `parseInput()`: `video` | `playlist` | `search` | `rejected`.
- **YtError** — erro tipado do yt-dlp; `code`: `private` | `unavailable` | `age_restricted` | `geo_blocked` | `bot_check` | `live` | `too_long` | `not_found` | `forbidden` | `extractor` | `timeout` | `unknown`.
- **Guard** — pré-condição do comando: `voice-join` (/play: usuário em canal de voz, o mesmo do bot se conectado) | `same-channel` (controles: bot conectado e usuário no mesmo canal) | `active-player` (/queue, /nowplaying: só bot conectado).
- **AdvanceOptions** — `{ skip, drop }` passado a `Queue.advance()`: `skip` ignora loop de faixa; `drop` não devolve a atual ao fim da fila no loop de fila.
- **Heartbeat / health monitor** — `src/health.ts`: grava `HEARTBEAT_FILE` com o gateway Ready (status **por shard**) e dispara shutdown com exit 1 após `GATEWAY_DOWN_EXIT_MINUTES`.
- **Testes puros** — `test/*.test.ts` com `test/setup.ts` bloqueando `child_process` e `fetch`.
- **pendingAdvance** — `AdvanceOptions` registrado por /skip, /stop e /playnow antes de parar o player; consumido no próximo Idle.
- **createPlayCommand(name, description, mode)** — fábrica em `src/commands/play.ts` usada por /play (`append`) e /playnow (`now`).
- **executePlay / PlayRequest** — `src/commands/playFlow.ts`: resolve, conecta, enfileira e responde; usado por /play, /playnow e pela escolha do /search.
- **PlayerEvents** — ganchos `trackStarted(player, track, announce)` / `trackFinished(player, track)` do `GuildPlayer`; ouvidos por `ControlPanels` e `PresenceTracker` (ligados em `index.ts`).
- **Painel** — mensagem com botões de controle da faixa atual. `ControlPanels` guarda até 5 por guild e desabilita ao fim da faixa, editando pelo canal.
- **customId** — `ctl:<toggle|skip|loop|stop>:<guildId>` (botões) e `srch:<guildId>:<userId>:<nonce>` (menu do /search); formato em `src/interactions/customId.ts`. `queue:` ainda é do collector do /queue.
- **Router** — `src/interactions/router.ts`: handler global de `interactionCreate` (comandos, autocomplete, botões, menus).
- **SuggestionProvider** — autocomplete com debounce, cache LRU/TTL, dedupe, limite de concorrência e timeout; nunca lança.
- **GuildRequester** — o que os guards (`checkJoin`, `checkPlayer`) leem de uma interação; vale para comandos e componentes.

## Convenções de código
- TypeScript strict, ESM (`"type": "module"`, imports com `.js`), sem `any`.
- Arquivos de classe em PascalCase (`GuildPlayer.ts`); módulos utilitários em camelCase/kebab (`url.ts`, `format.ts`).
- Um arquivo por comando em `src/commands/`, exportando `default` do tipo `Command`; registrar em `src/commands/index.ts`.
- Nomes de opções de slash command em português sem acento (`musica`, `posicao`, `nivel`, `modo`).
- Respostas: `say()` (pública, sem preview de link) e `deny()` (efêmera) em `src/commands/reply.ts`.
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
| `HEARTBEAT_FILE` | não | `/tmp/dj-heartbeat` | arquivo do healthcheck; definido vazio = desligado |
| `GATEWAY_DOWN_EXIT_MINUTES` | não | 5 | gateway fora por mais que isso → exit 1 (0 desliga) |
| `AUTOCOMPLETE_ENABLED` | não | `true` | sugestões no /play (mudar exige rodar o deploy) |
| `AUTOCOMPLETE_CACHE_TTL_SECONDS` | não | 600 | TTL do cache de sugestões (10–86400) |
| `PRESENCE_ENABLED` | não | `true` | status "Ouvindo <título>" |
| `LOG_LEVEL` | não | `info` | nível do pino |
| `NODE_ENV` | não | — | `production` desativa pino-pretty |
