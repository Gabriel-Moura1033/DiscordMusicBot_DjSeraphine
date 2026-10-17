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
