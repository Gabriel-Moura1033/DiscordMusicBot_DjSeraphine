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
