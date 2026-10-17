# 04 — Problemas, limitações e armadilhas

Status: `aberto` · `contornado` · `resolvido`.

## P-001 — yt-dlp quebra quando o YouTube muda
- **Status:** contornado
- **Sintoma:** `Requested format is not available`, `Sign in to confirm you're not a bot`, `nsig extraction failed`, HTTP 403.
- **Solução:** auto-update no start (`YTDLP_AUTO_UPDATE=true`); reiniciar o container força o update. Deno instalado para os desafios JS.

## P-002 — Bloqueio de IP / bot-check
- **Status:** aberto (limitação)
- **Sintoma:** `Sign in to confirm you're not a bot` mesmo atualizado; comum em IPs de datacenter/VPS.
- **Nota:** sem cookies (ADR-014). Rodar em IP residencial resolve na maioria dos casos.

## P-003 — Restrição de idade
- **Status:** aberto (limitação, por decisão)
- **Sintoma:** `Sign in to confirm your age`. Faixa é pulada com aviso.

## P-004 — Voz sem áudio (DAVE)
- **Status:** contornado
- **Sintoma:** bot entra no canal, status Playing, ninguém ouve.
- **Causa:** Discord exige protocolo DAVE (E2EE); `@discordjs/voice` < 0.19 não suporta.
- **Solução:** `@discordjs/voice` ≥ 0.19 com `@snazzah/davey`.

## P-005 — EPIPE ao matar o pipeline
- **Status:** contornado
- **Sintoma:** `write EPIPE` não tratado derruba o processo quando ffmpeg morre antes do yt-dlp.
- **Solução:** listeners de `error` em todos os stdio; EPIPE/ERR_STREAM_DESTROYED ignorados.

## P-006 — Itens de playlist sem duração
- **Status:** contornado
- **Sintoma:** com `--flat-playlist`, `duration` pode vir nulo; limite de duração não seria aplicado.
- **Solução:** `createStream()` roda `yt-dlp` com `--match-filter "duration <= N"`; se rejeitado, vira erro `too_long` e a faixa é pulada.

## P-007 — Lives
- **Status:** contornado
- **Solução:** rejeitadas na resolução (`is_live`) e no stream (`--match-filter !is_live`).

## P-008 — npm 12 bloqueia scripts de instalação
- **Status:** resolvido
- **Sintoma:** `install scripts blocked because they are not covered by allowScripts`; `@discordjs/opus` fica sem binário nativo.
- **Solução:** `npm install-scripts approve @discordjs/opus esbuild` (grava `allowScripts` no `package.json`). Ao atualizar versões, aprovar de novo.
