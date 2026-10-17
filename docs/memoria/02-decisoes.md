# 02 — Decisões (ADR curto)

Formato: `ADR-NNN — título` · data · decisão · contexto · alternativas descartadas.

---

## ADR-001 — YouTube como única fonte
- **Data:** 2026-10-17
- **Decisão:** `/play` aceita só URL de vídeo, URL de playlist do YouTube ou texto livre (vira `ytsearch1:`). Qualquer outro host é rejeitado antes de chamar o yt-dlp.
- **Contexto:** uso privado; menos superfície de erro e de abuso do yt-dlp (que aceita centenas de sites).
- **Descartado:** deixar o yt-dlp decidir (aceitaria Spotify/SoundCloud/sites arbitrários).

## ADR-002 — Streaming via pipe yt-dlp → ffmpeg
- **Data:** 2026-10-17
- **Decisão:** `yt-dlp -f bestaudio -o -` com stdout ligado ao stdin do `ffmpeg`, que entrega PCM s16le 48 kHz estéreo ao `AudioResource`. Nada é gravado em disco.
- **Contexto:** o yt-dlp lida com throttling, assinaturas e headers do YouTube.
- **Descartado:** `yt-dlp -g` + ffmpeg lendo a URL direta (URLs expiram, exigem headers, quebram mais); download para disco (requisito explícito).

## ADR-003 — PCM cru + inlineVolume
- **Data:** 2026-10-17
- **Decisão:** `StreamType.Raw` com `inlineVolume: true`; a codificação Opus acontece no Node via `@discordjs/opus` (fallback `opusscript`).
- **Contexto:** `/volume` precisa ter efeito imediato.
- **Descartado:** ffmpeg gerando Ogg/Opus (`StreamType.OggOpus`) — mais barato em CPU, mas mudar volume exigiria reiniciar o stream.

## ADR-004 — Ciclo de vida dos processos filhos
- **Data:** 2026-10-17
- **Decisão:** cada faixa tem um `kill()` idempotente que faz unpipe e `SIGKILL` em yt-dlp e ffmpeg; chamado em Idle, skip, stop, leave, desconexão e erro. `EPIPE` no stdin do ffmpeg é ignorado. No container, `init: true` (tini) como PID 1 recolhe órfãos.
- **Contexto:** requisito de zero processos zumbis.
- **Descartado:** depender só do fim natural do stream (não acontece em skip).

## ADR-005 — Metadados resolvidos no enfileiramento
- **Data:** 2026-10-17
- **Decisão:** `yt-dlp -J` (`--no-playlist` para vídeo, `--flat-playlist --playlist-end N` para playlist). Limite de duração verificado ao resolver; itens de playlist sem duração são reverificados ao tocar.
- **Contexto:** mostrar título/link ao usuário e validar limites antes de enfileirar; flat-playlist é rápido.
- **Descartado:** resolver cada item da playlist completo (lento, N processos).

## ADR-006 — Erros de vídeo pulam a faixa
- **Data:** 2026-10-17
- **Decisão:** stderr do yt-dlp é bufferizado e mapeado para erros tipados (privado, indisponível, idade, região, bot-check, live). A faixa é pulada e o canal de texto é avisado.
- **Contexto:** bot não pode cair por vídeo ruim.

## ADR-007 — Progresso via `resource.playbackDuration`
- **Data:** 2026-10-17
- **Decisão:** usar `playbackDuration` do AudioResource para a barra do `/nowplaying`.
- **Contexto:** já desconta pausas; evita contabilidade manual de timestamps.

## ADR-008 — Timer de inatividade único por guild
- **Data:** 2026-10-17
- **Decisão:** timer armado quando a fila esvazia ou o canal fica sem humanos; cancelado quando a condição deixa de valer. Padrão 5 min (`IDLE_TIMEOUT_SECONDS`).

## ADR-009 — Intents mínimas
- **Data:** 2026-10-17
- **Decisão:** só `Guilds` e `GuildVoiceStates`. Sem intents privilegiadas.

## ADR-010 — @discordjs/voice com DAVE
- **Data:** 2026-10-17
- **Decisão:** `@discordjs/voice` ≥ 0.19 (traz `@snazzah/davey` para o protocolo E2EE DAVE).
- **Contexto:** o Discord passou a exigir DAVE em canais de voz em 2026; versões antigas conectam sem áudio.

## ADR-011 — Node 24 LTS
- **Data:** 2026-10-17
- **Decisão:** Node 24 (Active LTS) na imagem e em `engines`.
- **Contexto:** proposta original era Node 22; usuário confirmou 24 por estar em Active LTS.
- **Descartado:** Node 22 (manutenção).

## ADR-012 — yt-dlp standalone com auto-update tolerante a falha
- **Data:** 2026-10-17
- **Decisão:** binário `yt-dlp_linux` (PyInstaller, sem Python/pip) em `/opt/yt-dlp/yt-dlp`, diretório gravável pelo usuário `node`. Entrypoint roda `yt-dlp -U` se `YTDLP_AUTO_UPDATE=true`; falha vira aviso e o bot sobe com a versão atual.
- **Contexto:** o YouTube quebra o yt-dlp com frequência; atualizar no start é o remédio mais barato.
- **Descartado:** instalar via pip; versão fixa só no build (exigiria rebuild a cada quebra).

## ADR-013 — Deno como runtime JS do yt-dlp
- **Data:** 2026-10-17
- **Decisão:** instalar Deno na imagem.
- **Contexto:** o yt-dlp atual precisa de runtime JS externo para resolver desafios do YouTube.

## ADR-014 — Sem suporte a cookies
- **Data:** 2026-10-17
- **Decisão:** não haverá opção de cookies. Vídeos com restrição de idade ou bloqueio "sign in to confirm" são pulados com aviso.
- **Contexto:** decisão do usuário (proposta de `YTDLP_COOKIES_FILE` recusada). `.gitignore` ainda ignora `cookies*` por precaução.

## ADR-015 — Git com Conventional Commits
- **Data:** 2026-10-17
- **Decisão:** repositório git desde o início, `.gitignore` no primeiro commit, um commit por etapa, mensagens em Conventional Commits.

## ADR-016 — Validação de config sem biblioteca
- **Data:** 2026-10-17
- **Decisão:** `src/config.ts` valida o `.env` à mão e falha rápido na inicialização.
- **Descartado:** zod (dependência extra para ~10 variáveis).

## ADR-017 — Guard de canal de voz por metadado
- **Data:** 2026-10-17
- **Decisão:** cada comando declara `requiresSameChannel`; o roteador aplica o guard antes de `execute`. `/play` com bot desconectado só exige que o usuário esteja em algum canal de voz.

## ADR-018 — /queue e /nowplaying não exigem estar no canal
- **Data:** 2026-10-17
- **Decisão:** guard `active-player` para comandos de leitura; só comandos que alteram o estado exigem `same-channel`.
- **Contexto:** "só quem está no canal pode controlar" — ver a fila não é controlar.

## ADR-019 — Aviso de "tocando agora" no canal de texto
- **Data:** 2026-10-17
- **Decisão:** cada faixa que começa por avanço da fila gera mensagem no canal do último /play (sem preview de link). A faixa iniciada pelo próprio /play não gera aviso extra (a resposta do comando já mostra).

## ADR-020 — Process group por processo filho
- **Data:** 2026-10-17
- **Decisão:** `spawn(..., { detached: true })` e `process.kill(-pid, 'SIGKILL')`.
- **Contexto:** o binário standalone do yt-dlp (PyInstaller onefile) é um bootloader que faz fork do interpretador; o yt-dlp ainda pode iniciar o Deno. SIGKILL só no pid principal deixaria órfãos.
- **Descartado:** `child.kill()` simples.

## ADR-021 — SIGTERM → SIGKILL na morte dos processos
- **Data:** 2026-10-17
- **Decisão:** `kill()` fecha os pipes, manda SIGTERM ao grupo e SIGKILL após 2 s só se o líder ainda estiver vivo. No `exit` do Node, SIGKILL direto. Atualiza ADR-004/ADR-020.
- **Contexto:** P-009 e P-010.
- **Descartado:** SIGKILL imediato (vaza `/tmp/_MEI*` do PyInstaller).

## ADR-022 — Deno via imagem oficial `denoland/deno:bin`
- **Data:** 2026-10-17
- **Decisão:** `COPY --from=docker.io/denoland/deno:${DENO_IMAGE_TAG}` (padrão `bin`). Imagens com nome totalmente qualificado (`docker.io/...`) para funcionar no podman sem short-name resolution.
- **Descartado:** baixar o zip do GitHub (precisaria mapear arquitetura e unzip).

## ADR-023 — Entrypoint atualiza o yt-dlp sem bloquear o start
- **Data:** 2026-10-17
- **Decisão:** `docker-entrypoint.sh` roda `yt-dlp --update-to stable` com `timeout 90`; falha imprime aviso + últimas linhas do erro e segue com `exec "$@"`. Binário em `/opt/yt-dlp` (dono `node`).

## ADR-024 — Retry silencioso de stream antes do áudio começar
- **Data:** 2026-10-17
- **Decisão:** `GuildPlayer` reinicia o stream da mesma faixa até `MAX_STREAM_RETRIES = 2` vezes quando a falha é `YtError.retriable` e tocou < 2 s; só depois pula e avisa. Contador zera a cada faixa nova.
- **Contexto:** P-011 (403 intermitente do googlevideo).
- **Descartado:** `--retries` do yt-dlp (não repete 403; a URL assinada é a mesma); retomar no meio da faixa (exigiria seek com `--download-sections`).

## ADR-025 — Deploy remove comandos globais
- **Data:** 2026-10-17
- **Decisão:** o script de registro substitui a lista global por `[]` depois de registrar os comandos da guild.
- **Contexto:** P-012; a aplicação é dedicada a este bot e só usa comandos por guild.
- **Descartado:** apagar manualmente uma vez (sobras voltariam a confundir se a aplicação fosse reutilizada).

## ADR-026 — /playnow
- **Data:** 2026-10-17
- **Decisão:** `/playnow` insere as faixas no início da fila (`Queue.addFront`) e pula a atual com `{ skip: true, drop: false }` — mesma semântica do /skip: a atual é descartada, exceto no loop de fila (vai para o fim). Playlists também são aceitas (entram todas na frente, em ordem). Sem nada tocando, equivale ao /play.
- **Contexto:** pedido do usuário: "pular a faixa atual e tocar a pedida, sem perder a fila".
- **Implementação:** `/play` virou fábrica `createPlayCommand` para reaproveitar validação, busca, conexão e embeds; `GuildPlayer.playNow()` + `quietNextStart` (a resposta do comando já mostra a faixa).
- **Descartado:** devolver a faixa interrompida para a fila (o pedido foi "pular").

## ADR-027 — Watchdog da conexão de voz e descarte de player "stale"
- **Data:** 2026-10-17
- **Decisão:** fora de Ready por 20 s → `connection.rejoin()` uma vez; mais 20 s sem Ready → aviso + `destroy()`. `PlayerManager.get()` destrói players `isStale()` antes de qualquer comando usá-los.
- **Contexto:** P-015.
- **Descartado:** reconectar mantendo a mesma instância de `GuildPlayer` (exigiria trocar a `VoiceConnection` e religar listeners; adiado — ver 05).

## ADR-028 — vitest com testes puros
- **Data:** 2026-10-17
- **Decisão:** vitest como runner; testes em `test/`, só de módulos puros. Um setup global faz `child_process.spawn/execFile` e `fetch` lançarem erro, garantindo que `npm test` nunca dependa de rede, yt-dlp, ffmpeg ou YouTube. Testes rodam no estágio `build` do Dockerfile (teste quebrado = imagem não gerada).
- **Contexto:** requisito do usuário (Fase 1). Substitui a ideia do backlog de usar `node:test`.

## ADR-029 — Heartbeat + saída com erro quando o gateway cai
- **Data:** 2026-10-17
- **Decisão:** o processo grava `HEARTBEAT_FILE` a cada 15 s enquanto o gateway está Ready (HEALTHCHECK no Dockerfile e no compose lê o mtime). Se o gateway ficar fora por mais de `GATEWAY_DOWN_EXIT_MINUTES` (padrão 5; 0 desliga), o processo faz shutdown e sai com código 1; `restart: unless-stopped` recria o processo.
- **Contexto:** Compose não reinicia containers "unhealthy"; a saída com erro substitui um autoheal. Healthcheck também no compose porque o podman ignora `HEALTHCHECK` em imagens OCI.
- **Descartado:** serviço autoheal (dependência extra com acesso ao socket do Docker).

## ADR-030 — Botões de controle (Fase 2; revisa ADR-019)
- **Data:** 2026-10-17
- **Decisão:** a resposta do /play que começa a tocar na hora ganha botões; avanços da fila geram embed compacto com botões. Cliques tratados num handler global de `interactionCreate`, com `customId` codificando ação + guildId (sem collectors por mensagem). Botões são desabilitados/atualizados editando a mensagem pelo canal (token do bot), não por `interaction.editReply` (token da interação expira em 15 min).
- **Contexto:** aprovado pelo usuário ao revisar a ADR-019.

## ADR-031 — SQLite como espelho da fila em memória (Fase 6; substitui "fila só em memória")
- **Data:** 2026-10-17
- **Decisão:** fila e estado continuam em memória durante a execução; o SQLite guarda um espelho para sobreviver a restart e à destruição do player (P-015). Ao restaurar, o primeiro /play avisa "fila anterior com N faixas restaurada — use /clear para descartar". No start não reconecta ao canal.
- **Contexto:** substitui a decisão original de fila apenas em memória (`01-arquitetura.md`); aprovado pelo usuário.
