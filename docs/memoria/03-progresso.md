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
