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

## P-009 — yt-dlp standalone vaza /tmp/_MEI* quando morto com SIGKILL
- **Status:** resolvido
- **Sintoma:** cada execução do `yt-dlp_linux` (PyInstaller onefile) extrai ~30 MB em `/tmp/_MEIxxxx`; com SIGKILL o bootloader não limpa, e cada /skip vazaria um diretório.
- **Solução:** `terminateGroup()` manda SIGTERM ao process group (o bootloader repassa e limpa) e só faz SIGKILL após 2 s se o líder não saiu. `/tmp` em tmpfs no compose como rede de segurança. Verificado no container: `/tmp` vazio após kills seguidos.

## P-010 — ffmpeg ignora SIGTERM e 'close' nunca dispara após kill
- **Status:** resolvido
- **Sintoma:** após `kill()`, `failure()` sempre esgotava o timeout; ffmpeg sobrevivia até o SIGKILL. Num teste anterior o processo ficou preso por minutos.
- **Causa:** ffmpeg bloqueado escrevendo num stdout sem leitor trata SIGTERM só depois do write; e o Node só emite `close` quando os pipes fecham.
- **Solução:** `kill()` faz `destroy()` em `src.stdout`, `dec.stdin` e `dec.stdout` antes de sinalizar. Tudo termina em < 300 ms. (Em uso real o `@discordjs/voice` já destrói o `playStream` no stop, mas o pipeline não depende mais disso.)

## P-011 — HTTP 403 intermitente ao baixar o áudio
- **Status:** contornado
- **Sintoma:** 2ª faixa da fila falhou com "o yt-dlp não conseguiu extrair o áudio"; log: `[info] Downloading 1 format(s): 251` → `ERROR: unable to download video data: HTTP Error 403: Forbidden` (cliente `visionos`, sem PO Token provider). Mesma URL baixou normalmente em 3 tentativas manuais logo depois.
- **Causa:** googlevideo recusa a URL assinada de forma intermitente; não é yt-dlp desatualizado (já estava na última versão). O 403 estava classificado como `extractor`, gerando mensagem enganosa.
- **Solução:** código próprio `forbidden`; falhas `forbidden`/`extractor`/`timeout`/`unknown` antes de 2 s de áudio são tentadas de novo em silêncio (até 2 vezes, extração nova). Se persistir com frequência, avaliar um PO Token provider (ex.: bgutil) — ver 05.
- **Limitação:** 403 no meio da faixa não é retomado (a faixa é marcada como interrompida).

## P-012 — Comandos globais antigos ("Comando desconhecido")
- **Status:** resolvido
- **Sintoma:** `/test` e `/challenge` apareciam no servidor; ao usar, o bot respondia "Comando desconhecido". Log: `unknown command ... name: challenge`.
- **Causa:** comandos **globais** registrados por um uso anterior da mesma aplicação do Discord.
- **Solução:** `deploy-commands.ts` agora também apaga os comandos globais (`PUT []`) após registrar os da guild. Removidos em 2026-10-17. Pode levar alguns minutos/Ctrl+R para sumirem do cliente.

## P-013 — Faixa terminou ~40 s antes sem erro
- **Status:** aberto (em observação)
- **Sintoma:** `joMjcNtxuTU` (162 s) teve "track started" de novo após 122 s, sem nenhum warn (sem falha do yt-dlp/ffmpeg nem erro do AudioPlayer). Como a mesma faixa recomeçou, provavelmente o loop de faixa estava ligado.
- **Hipótese:** stream cortado sem erro, ou `failure()` estourou o prazo de 3 s e o fim foi tratado como natural.
- **Ação:** adicionados logs `track ended` (playedSec, durationSec, endedBy) e `track ended early` (warn, com códigos de saída e stderr dos processos) para diagnosticar na próxima ocorrência.

## P-014 — "O aplicativo não respondeu" / deploy com `Missing Access`
- **Status:** resolvido (configuração)
- **Causas vistas:** (1) usar no Discord o comando de **outra aplicação** com o mesmo nome de comando; o log do bot fica vazio. (2) `DISCORD_GUILD_ID` de um servidor onde o bot não está → deploy falha com `Missing Access`.
- **Diagnóstico rápido:** conferir no log o `user` do "bot ready" e se a interação aparece; `Routes.userGuilds()` lista onde o bot está.

## P-015 — Bot responde "tocando" mas não está no canal de voz
- **Status:** contornado
- **Sintoma:** /play respondeu "Tocando agora" sem o bot estar no canal. Log: sem novo "joined voice channel" (player antigo reutilizado). API do Discord: `GET /guilds/{id}/voice-states/{bot}` → 404 Unknown Voice State. Antes disso, uma faixa de 259 s levou 447 s de relógio (≈3 min em auto-pausa: `NoSubscriberBehavior.Pause` pausa quando a conexão não está Ready).
- **Causa (confirmada pelo usuário em 2026-10-17):** o PC host entrou em **suspensão (sleep)**. O processo congela; o Discord derruba a sessão de voz do bot, mas localmente a `VoiceConnection` continua "Ready" ou fica presa reconectando. Os ~3 min "perdidos" em "Beat It" foram uma suspensão durante a reprodução (relógio de parede anda, áudio não).
- **Nota:** timers do Node (libuv, `CLOCK_MONOTONIC`) não contam o tempo suspenso; `Date.now()` conta. O timer de inatividade não "dispara atrasado" ao acordar; o `isStale()` usa `Date.now()` e o cache de voice states, atualizado quando o gateway reconecta.
- **Solução:** log de toda transição de estado da conexão (`voice connection state`); watchdog de 20 s fora de Ready → `rejoin()` (1×) → se falhar, avisa e destrói; `GuildPlayer.isStale()` (destruída, presa fora de Ready ou bot ausente do canal segundo o cache de voice states) faz `PlayerManager.get()` descartar o player para o /play reconectar.
- **Limitação:** quando o watchdog desiste, a fila da guild é perdida.

## P-016 — `client.ws.status` nunca sai de Ready
- **Status:** resolvido
- **Sintoma:** com a rede do container desconectada, o monitor do gateway não registrou nada por 3+ min e o processo não saiu.
- **Causa:** no discord.js 14.27, `WebSocketManager.status` vira Ready no primeiro ready e não é atualizado em quedas/reconexões; quem muda é `client.ws.shards.get(id).status` (Connecting, Resuming, Identifying…).
- **Solução:** `src/health.ts` considera o gateway pronto só se **todos os shards** estão Ready. Validado: rede cortada → zumbi detectado em ~110 s (heartbeat sem ACK) → `GATEWAY_DOWN_EXIT_MINUTES=1` → exit 1 após 60 s; podman reinicia com `unless-stopped`.

## P-017 — Bloqueio regional classificado como "unknown"
- **Status:** resolvido (encontrado pelos testes da Fase 1)
- **Causa:** a mensagem real do yt-dlp é "The uploader has not made this video available in your country"; o regex exigia "not available in your country".
- **Solução:** regex `geo_blocked` passa a casar "available in your country".

## P-018 — Aviso ERESOLVE do opusscript
- **Status:** resolvido
- **Causa:** `prism-media@1.3.5` declara peer opcional `opusscript@^0.0.8`; o projeto tinha `^0.1.1`.
- **Solução:** `opusscript` fixado em `^0.0.8` (só é usado se o `@discordjs/opus` nativo falhar).
