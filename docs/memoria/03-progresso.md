# 03 — Progresso

Diário cronológico, mais recente por último.

## 2026-10-17 — Arquitetura aprovada e repositório criado
- Proposta de arquitetura apresentada e confirmada; decisões ADR-001 a ADR-017.
- Criados: `.gitignore`, `CLAUDE.md`, `docs/memoria/*`.
- Pendente: código, Docker, README.

## 2026-10-17 — Base do projeto
- `package.json` (ESM, Node ≥ 24), `tsconfig.json` (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), TypeScript 7.
- `src/config.ts` (validação manual, falha rápida), `src/logger.ts` (pino; pino-pretty fora de produção).
- npm 12 bloqueia install scripts: `@discordjs/opus` e `esbuild` aprovados em `allowScripts` no `package.json`.

## 2026-10-17 — Camada YouTube
- `src/youtube/url.ts`, `errors.ts`, `process.ts`, `YouTubeService.ts`; `src/util/json.ts`, `format.ts`.
- Smoke test no host (yt-dlp 2026.08.19): busca ~1,3 s, playlist flat ~1,1 s, vídeo completo ~2 s; erro de vídeo inexistente e `--match-filter` mapeados; kill não deixa processos.

## 2026-10-17 — Player
- `src/player/Queue.ts` (fila pura; `advance({skip, drop})` cobre loop off/track/queue, skip e falhas).
- `src/player/GuildPlayer.ts` (conexão, AudioPlayer, timers idle/alone, aviso de falha, reconexão em 5 s).
- `src/player/PlayerManager.ts` (Map por guild + Map de conexões pendentes para /play concorrente).

## 2026-10-17 — Comandos e bootstrap
- `src/commands/*` (12 comandos, guards, respostas, embeds, roteador), `src/index.ts`, `src/deploy-commands.ts`.
- Verificado: `tsc` limpo, sem `any`; build roda, checa yt-dlp/ffmpeg no start, falha controlada com token inválido; JSON dos comandos gerado; lógica de loop/skip/drop da fila testada em script.
- Pendente: Docker, README, teste real em servidor.

## 2026-10-17 — Container
- `Dockerfile` (multi-stage: deps com toolchain p/ @discordjs/opus, build TS, runtime node:24-bookworm-slim + ffmpeg + deno + yt-dlp_linux), `docker-entrypoint.sh`, `docker-compose.yml` (init, tmpfs /tmp, logs rotacionados), `.dockerignore`, `.env.example`.
- Testado com podman 6.1: opus nativo carrega; busca no container ~1,5 s; 3 kills seguidos + faixa completa sem processos restantes e `/tmp` vazio; update sem rede gera aviso e o bot sobe.
- Corrigidos P-009 e P-010 (ver 04).

## 2026-10-17 — Documentação
- `README.md`: Developer Portal, intents, permissões (3165184), link de convite, Docker/Podman, dev local, troubleshooting de yt-dlp, voz e processos.
- `podman compose config` valida o compose.
- Salas 00 e 05 atualizadas com o estado da v0.1.0.
- Pendente: teste em servidor real (ver 05).

## 2026-10-17 — Primeira execução real
- Credenciais tinham sido preenchidas no `.env.example` (versionado); movidas para `.env` (chmod 600) antes de qualquer commit e `.env.example` restaurado. Histórico verificado sem token.
- `podman compose build` + deploy de comandos: 12 comandos registrados na guild. `podman compose up -d`: entrypoint ok, binários ok, gateway conectado ("bot ready", bot presente em 2 guilds; comandos só na guild do `.env`).
- Pendente: testes de voz no Discord (ver 05).

## 2026-10-17 — Correção do 403 intermitente
- Primeiro teste real: voz funciona (faixa 1 tocou completa, ~4 min). Faixa 2 falhou com HTTP 403 (P-011).
- `errors.ts`: código `forbidden` + `YtError.retriable`; `GuildPlayer`: `startStream()` separado de `playNext()`, retry silencioso (ADR-024). Imagem reconstruída e bot reiniciado.

## 2026-10-17 — Análise de logs após testes
- Retry do 403 confirmado em produção: `5dPwBWvmcbQ` falhou com 403 na 1ª tentativa e tocou na 2ª.
- Comandos globais antigos removidos (P-012); `deploy-commands.ts` passa a limpá-los sempre.
- Fim antecipado sem erro observado (P-013): adicionado log de diagnóstico em `GuildPlayer.onTrackEnd` e `ActiveStream.diagnostics()`.

## 2026-10-17 — Troca de servidor
- `DISCORD_GUILD_ID` alterado no `.env`; comandos registrados na nova guild e container recriado (`up -d --force-recreate`, necessário para reler o `env_file`).
- O servidor de testes anterior continua com os 12 comandos registrados e o bot como membro.
- Lembrete: trocar de guild exige rodar o deploy de comandos de novo antes de reiniciar.

## 2026-10-17 — Troca de aplicação do Discord
- "O aplicativo não respondeu": o comando usado era de outra aplicação (sem processo rodando), não da que estava no `.env`. Confirmado via API (`Routes.currentApplication`).
- Usuário trocou token/client id para a aplicação definitiva e a guild para o servidor onde ela está. Primeira tentativa de deploy deu `Missing Access` (bot não era membro da guild configurada).
- Deploy ok na guild nova (12 comandos); a nova aplicação também tinha os globais antigos `/test` e `/challenge`, removidos pelo deploy (P-012). Container recriado, "bot ready" em 1 guild.

## 2026-10-17 — Comando /playnow
- `src/commands/playnow.ts`, fábrica `createPlayCommand` em `play.ts`, `Queue.addFront`, `GuildPlayer.playNow`. README e glossário atualizados.
- Verificado: typecheck; ordem da fila após /playnow nos 3 modos de loop e com playlist (script). Deploy: 13 comandos na guild; bot reiniciado.
- Pendente: teste no Discord.

## 2026-10-17 — Conexão de voz presa
- Investigado P-015 (bot "tocando" fora do canal). `GuildPlayer`: log de estados da conexão, watchdog com rejoin, `isStale()`; `PlayerManager.get()` descarta players mortos. Typecheck ok; bot reconstruído e reiniciado.
- Pendente: confirmar em uso; se repetir, os logs `voice connection state` mostram a sequência.

## 2026-10-17 — Causa do P-015
- Usuário confirmou: PC host em sleep. P-015 atualizado (causa + nota sobre timers e suspensão); README ganhou linha de troubleshooting com `systemd-inhibit`.

## 2026-10-17 — Fase 1: testes e operação
- vitest 5 + `test/setup.ts` (bloqueia spawn/exec/fetch); 103 testes: URL (aceitos/rejeitados/buscas), fila (add, remove, shuffle, loop off/track/queue, skip/drop, playnow), erros do yt-dlp, formatação. `npm test`, `npm run typecheck` (inclui test/). Testes rodam no build da imagem.
- `src/health.ts` (heartbeat + exit 1 com gateway fora), shutdown gracioso em `src/index.ts`, `waitForChildren()` em `process.ts`. HEALTHCHECK no Dockerfile e no compose; `stop_grace_period` 15 s. Novas variáveis `HEARTBEAT_FILE`, `GATEWAY_DOWN_EXIT_MINUTES`.
- Validado: imagem com testes passando; `healthy`; stop → "bye" exit 0; 2 pipelines encerrados em 9 ms sem `/tmp/_MEI*`; rede cortada → exit 1 → podman reinicia; `podman compose top dj` só com init + node.
- Problemas: P-016, P-017, P-018. ADRs: 028–031 (030/031 antecipam decisões das Fases 2 e 6).

## 2026-10-17 — Fase 2: interface no chat
- Botões de controle (`src/interactions/controls.ts`, `controlButtons.ts`), handler global `router.ts`, `/search` com menu (`commands/search.ts`, `interactions/searchSelect.ts`, `searchSessions.ts`, `searchMenu.ts`), autocomplete do /play (`suggestions.ts`), presença (`src/presence.ts`). Fluxo do /play extraído para `commands/playFlow.ts`. Guards generalizados (`checkJoin`/`checkPlayer`) para comandos e componentes. `GuildPlayer` emite `PlayerEvents`; o aviso "tocando agora" virou embed com botões. `YouTubeService.search()`.
- Config: `AUTOCOMPLETE_ENABLED`, `AUTOCOMPLETE_CACHE_TTL_SECONDS`, `PRESENCE_ENABLED`. ADRs 032–034; ADR-030 complementada.
- Testes: 157 (+54): `customId`, ciclo do loop, `controlRow`, `ControlPanels` com canal falso, `PresenceTracker` com timers falsos, `SuggestionProvider` (debounce, cache/TTL, dedupe, timeout, concorrência, falhas), `SearchSessions`, `suggestionFor`. O setup agora também troca o logger por um mudo (o real carrega a config). Um teste achou bug: throw síncrono da busca escapava e vazava o contador de concorrência.
- Validado: imagem gerada com testes; deploy com 14 comandos (1ª tentativa deu timeout de rede momentâneo); `healthy`; `top` só init + node; `ytsearch5` flat em ~1,5 s no container.
- Pendente: teste no Discord (cliques, permissões, expiração do menu, presença).

## 2026-10-17 — Fase 3: comandos de fila
- `/move`, `/skipto`, `/clear`, `/previous`, `/replay`, `/seek` (20 comandos). `Queue.move/prepareSkipTo`, `History` (`HISTORY_SIZE`), `util/time.ts` (`parseTimestamp`), `GuildPlayer.skipTo/previous/seek` + `startOffsetSec`, `YouTubeService.createStream(track, startSec)`.
- Seek: comparadas 4 abordagens no container (ADR-035); escolhida `ffmpeg -ss` no pipe (exata, 2–7 s, qualquer formato).
- Testes: 205 (+48). Destaque: /skipto comparado com /skip repetido em 12 combinações (3 loops × 4 posições).
- Teste de integração no container com o código compilado (`createStream` + `waitForAudio` reais): achou P-019 e um 403 no seek sem retry → seek ganhou as mesmas 2 novas tentativas silenciosas. Sem processos nem `_MEI` restantes.
- Pendente: teste no Discord (seek/replay/previous com áudio real).

## 2026-10-17 — Fase 4: autoplay
- `/autoplay` (21 comandos), `src/player/autoplay.ts`, `YouTubeService.mix()` + `playableEntries()` (também usado pela busca), `Queue.removeWhere`, `Track.autoplayFrom`, `requesterLabel()` nos embeds, autoplay no rodapé do /queue. Config `AUTOPLAY_DEFAULT`, `AUTOPLAY_RECENT_LIMIT`. ADR-037.
- Testes: 228 (+23): `titleKey` com títulos reais, escolha do candidato (semente, recentes, versões, duração), `queueEndAction` (regra do timer), `RecentTracks`, `removeWhere`, parse do JSON do mix.
- Validado no container com código compilado: cadeia de 6 faixas (~1,4 s por mix, uma de 3,6 s), sem processos restantes; deploy com 21 comandos; `healthy`.
- Pendente: teste no Discord (transição sem silêncio, timer de inatividade, /stop).

## 2026-10-17 — Fase 5: qualidade de áudio
- `src/audio/filters.ts` (cadeia `-af`, `mediaPosition`, `effectiveDuration`), `src/audio/sponsorblock.ts`, `GuildSettings`, `Queue.peekNext`, `createStream(track, { startSec, audioFilter })`, `GuildPlayer` com `StreamPlan`, pré-carga, cortes tardios e `setFilter`; `/filtro` (22 comandos); filtro no /nowplaying. Config: `LOUDNORM_ENABLED`, `PRELOAD_ENABLED`, `PRELOAD_SECONDS`, `SPONSORBLOCK_ENABLED`, `SPONSORBLOCK_API_URL`, `DEFAULT_FILTER`. ADRs 038–041.
- Medições antes de implementar: CPU por filtro, latência com loudnorm, base de tempo do `aselect` depois de `-ss` (relativa ao seek).
- Testes: 251 (+23). Um ajuste de fronteira em `mediaPosition` (exatamente no início de um corte = fim do corte).
- Integração no container (código compilado): API real (~200 ms, cortes em 3 de 4 clipes); stream com seek + corte + nightcore + loudnorm com duração esperada; pré-carga parada 60 s tocou inteira; nenhum processo restante. Deploy 22 comandos; `healthy`; `top` só node.
- Pendente: teste no Discord (transição com pré-carga, filtros de ouvido).

## 2026-10-17 — Fase 6 cancelada; encerramento da leva
- Plano da Fase 6 (SQLite) apresentado; usuário cancelou: "manteremos o estado atual do projeto por enquanto". ADR-031 marcada como adiada; plano guardado em 05.
- Estado final da leva: Fases 1–5 concluídas, 22 comandos, 251 testes, bot rodando `healthy`.

## 2026-10-17 — Fase 6 retomada: persistência SQLite
- Usuário retomou a Fase 6 e confirmou as duas propostas (pedido toca antes da fila restaurada; autoplay fora do /top).
- `src/db/` (`database.ts`, `migrations.ts`, `repositories.ts`), `PlayerManager` com espelho/hidratação, `GuildPlayer` (restore, `queueSnapshot`, `seedHistory`, `trackPlayed`, `destroy({ discardQueue })`), `GuildSettings` com loop/autoplay/volume, guard `none`, `/top`, `/playlist` (24 comandos), entrada `saved` no `playFlow`. Volume `dj-data`, `data/` ignorado. Config `DB_PATH`, `PLAYLISTS_PER_USER`. ADR-042.
- Testes: 280 (+29) com SQLite em memória: migrações (do zero, reaplicar, só as novas, rollback, downgrade), settings (inclusive valores obsoletos), fila (ida e volta), /top (períodos, escopos, autoplay e outras guilds fora), playlists (CRUD, maiúsculas, por usuário, limite, autocomplete), nomes e períodos. Um teste revelou que o histórico recriado perdia a marca de autoplay; corrigido.
- Validado no container: banco no volume (WAL, dono `node`), dados sobrevivem a `down`/`up`, shutdown limpo; deploy 24 comandos; `healthy`.
- Pendente: teste no Discord (restauração depois de restart, /top, /playlist).
