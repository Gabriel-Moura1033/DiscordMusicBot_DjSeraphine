# 01 — Arquitetura

## Camadas
| Camada | Pasta | Responsabilidade |
|---|---|---|
| Entrada | `src/index.ts` | Cria o `Client`, roteia `interactionCreate`, aplica guards, repassa `voiceStateUpdate` ao `PlayerManager` |
| Comandos | `src/commands/` | Um arquivo por slash command (`Command`: `data`, `guard`, `execute`). Só valida entrada e formata resposta |
| Player | `src/player/` | `PlayerManager` (Map guildId → `GuildPlayer`), `GuildPlayer` (conexão, AudioPlayer, timers), `Queue` (estrutura pura) |
| YouTube | `src/youtube/` | `url.ts` (classificar/normalizar entrada), `YouTubeService` (metadados + stream), `errors.ts` (stderr → erro tipado), `process.ts` (spawn/kill) |
| Infra | `src/config.ts`, `src/logger.ts` | Config validada; logger pino |
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
