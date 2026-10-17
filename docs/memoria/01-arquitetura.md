# 01 — Arquitetura

## Camadas
| Camada | Pasta | Responsabilidade |
|---|---|---|
| Entrada | `src/index.ts` | Cria o `Client` e os serviços, liga `PlayerEvents` (painéis + presença), repassa `voiceStateUpdate` ao `PlayerManager` |
| Interações | `src/interactions/` | `router.ts` (handler global de `interactionCreate`), botões de controle, menu do /search, autocomplete, formato de `customId` |
| Comandos | `src/commands/` | Um arquivo por slash command (`Command`: `data`, `guard`, `execute`). Só valida entrada e formata resposta |
| Player | `src/player/` | `PlayerManager` (Map guildId → `GuildPlayer`), `GuildPlayer` (conexão, AudioPlayer, timers), `Queue` (estrutura pura) |
| YouTube | `src/youtube/` | `url.ts` (classificar/normalizar entrada), `YouTubeService` (metadados + stream), `errors.ts` (stderr → erro tipado), `process.ts` (spawn/kill) |
| Infra | `src/config.ts`, `src/logger.ts`, `src/health.ts`, `src/presence.ts` | Config validada; logger pino; heartbeat; presença |
| Registro | `src/deploy-commands.ts` | PUT dos comandos por guild via REST |

## Fluxo do /play
1. `interactionCreate` → `commands/index.ts` encontra o comando → `guards.ts` (`voice-join`: usuário em canal de voz; se bot já conectado, mesmo canal).
2. `deferReply()` (yt-dlp pode passar de 3 s).
3. `url.parseInput()` → `video | playlist | search | rejected`, com URL canônica (`https://www.youtube.com/watch?v=ID` / `playlist?list=ID`).
4. `YouTubeService.resolve()` → `yt-dlp -J` → `Track[]`; aplica limite de duração e de playlist.
5. `PlayerManager.getOrCreate()` → `GuildPlayer.connect()` (aguarda `Ready`, timeout 20 s) → `enqueue()`.
6. Se o player está ocioso, `playNext()`:
   - `Queue.next(loopMode)` escolhe a faixa
   - `YouTubeService.createStream()` → spawn `yt-dlp -o -` | `ffmpeg -f s16le` → `AudioResource` (Raw, inlineVolume)
   - `AudioPlayer.play(resource)`
7. `AudioPlayerStatus.Idle` → `kill()` do stream atual → se falhou antes de tocar, avisa o erro mapeado → `playNext()`.
8. Fila vazia → arma timer de inatividade → `destroy()` (kill + `connection.destroy()` + remove do Map).

## Interface no chat (Fase 2)
- `interactionCreate` → `routeInteraction`: slash → `handleCommand`; autocomplete → `Command.autocomplete`; botão `ctl:` → `controlButtons.ts`; menu `srch:` → `searchSelect.ts`. Prefixos desconhecidos são ignorados (o `/queue` ainda usa collector).
- `GuildPlayer.playNext()` emite `trackFinished` (da anterior) e `trackStarted(announce)`; `destroy()` emite `trackFinished`. `ControlPanels` envia o embed "tocando agora" com botões quando `announce`, e desabilita os painéis da faixa ao fim. Respostas do /play (posição 0) e do /nowplaying são anexadas com `attach()`.
- Clique: `checkPlayer` sem exigir canal → painel ativo? (senão desliga e explica) → `checkPlayer` exigindo o mesmo canal → ação → `interaction.update()` com os botões atualizados; skip/stop também mandam aviso público via `followUp`.
- /search: `youtube.search(q, 5)` → embed + select → `SearchSessions` (60 s; expira editando pelo canal). Escolha: dono? → `checkJoin` → consome a sessão → `deferUpdate` → `executePlay` (re-resolve o vídeo) e a mensagem da busca vira a resposta.
- Autocomplete: `SuggestionProvider` (≥ 3 letras, sem links, debounce 350 ms/usuário, cache LRU 200 com TTL, dedupe, ≤ 2 buscas, espera 2 s; a busca continua até 15 s para encher o cache).

## Comandos de fila (Fase 3)
- `/skipto n`: `Queue.prepareSkipTo(n)` + `stopCurrent({ skip: true, drop: true })`. `/previous`: `history.pop()` → `addFront([anterior, atual])` + `stopCurrent({ skip, drop })`; `skipHistoryOnce` impede a atual de entrar no histórico. `/clear`: `queue.clearUpcoming()`.
- Histórico: `onTrackEnd` faz `history.push(track)` se houve áudio (`playbackDuration > 0`).
- `/seek t` e `/replay` (= seek 0): `GuildPlayer.seek()` abre novo pipeline com `ffmpeg -ss t` (antes do `-i pipe:0`), espera `waitForAudio` (dados no `playStream`; `readable` sem dados = fim/falha), até 2 novas tentativas em falha retentável, e só então `audioPlayer.play(novo)` + `kill()` do antigo. Trocar recurso com o player ativo não passa por Idle, então a fila não avança. Se a faixa mudar no meio (`active !== before` ou nova geração), o stream novo é descartado.

## Autoplay (Fase 4)
- `playNext()` → após `trackStarted`, `maybePrefetchAutoplay()`: autoplay ligado, fila vazia e loop off → `fetchAutoplay(atual)` (busca antecipada).
- `fetchAutoplay(seed)` → `youtube.mix(id)` (`watch?v=ID&list=RDID`, flat, 25 itens, ~1,4 s) → `onAutoplayResult`: descarta se a geração mudou, ou se a fila mudou (atual ≠ semente ou fila com itens); senão escolhe com `pickAutoplayCandidate` evitando histórico + recentes do autoplay + fila + atual + semente, e enfileira (ou toca, se a fila já tinha acabado).
- Fim da fila → `onQueueEnd(seed = anterior ?? history[0], stopped)` → `queueEndAction`: `idle` (arma timer), `wait` (busca da mesma semente em andamento), `fetch`, `exhausted` (avisa + timer). Enquanto busca com a fila parada, o timer de inatividade fica desarmado; o timer de "sozinho" é independente.
- `/stop` marca `stopRequested` e cancela buscas (`autoplayGeneration++`); desligar o autoplay também tira da fila as faixas com `autoplayFrom`.

## Estado por guild (`GuildPlayer`)
- `connection: VoiceConnection`, `audioPlayer: AudioPlayer`
- `queue: Queue` (current, upcoming, loopMode)
- `volume` (0–100), `textChannel` (último canal onde /play foi usado; destino dos avisos)
- `active: ActiveStream | null` (resource + processos + stderr)
- `idleTimer` / `aloneTimer`

## Desconexão
- `VoiceConnectionStatus.Disconnected`: tenta reconectar (Signalling/Connecting em 5 s); se falhar, `destroy()`.
- Watchdog (ADR-027): fora de Ready por 20 s → `rejoin()` (1×) → mais 20 s → aviso + `destroy()`. `PlayerManager.get()` descarta players `isStale()`.
- `Destroyed` → `PlayerManager` remove a guild do Map.

## Processos filhos
- `spawnPipeline()` liga `yt-dlp.stdout → ffmpeg.stdin`, cada processo em process group próprio. `kill()` idempotente fecha os pipes, manda SIGTERM ao grupo e SIGKILL após 2 s se preciso (ADR-021).
- `tini` (via `init: true` no compose) é PID 1 no container.

## Operação (Fase 1)
- `src/health.ts`: heartbeat + saída com exit 1 se o gateway ficar fora por `GATEWAY_DOWN_EXIT_MINUTES` (ADR-029). Iniciado no primeiro `ClientReady`.
- Shutdown (`src/index.ts`): SIGTERM/SIGINT → para o monitor → `players.destroyAll()` (sai dos canais, mata pipelines) → `waitForChildren(5 s)` → `client.destroy()` → `exit`. Segundo sinal força saída.
- Testes: `test/` (vitest, puros). Rodam no estágio `build` do Dockerfile.
