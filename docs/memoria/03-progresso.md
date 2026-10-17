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
