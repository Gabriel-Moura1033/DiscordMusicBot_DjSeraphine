# 00 — Entrada

**O que é:** bot de música para Discord, uso privado (um servidor de amigos). Toca **apenas YouTube** via yt-dlp → ffmpeg → @discordjs/voice. Node 24 + TypeScript strict, discord.js v14, slash commands, fila em memória por guild, Docker.

## Estado atual (2026-10-17)
- 24 comandos, 280 testes. Leva de 2026-10-17 concluída: Fases 1 (testes, healthcheck, shutdown), 2 (botões, /search, autocomplete, presença), 3 (/move, /skipto, /clear, /previous, /replay, /seek, histórico), 4 (/autoplay), 5 (loudnorm, pré-carga, SponsorBlock, /filtro) e 6 (SQLite: fila/configurações restauradas, /top, /playlist). Fase 7 (painel web) em andamento: 7a (camada de controle) feita.
- Fases 2–6 validadas no container e com testes, mas ainda **sem teste no Discord** (ver checklist em 05). Implementado: fila por guild, pipeline yt-dlp → ffmpeg com kill limpo, Docker.
- Verificado: typecheck strict, resolução/streaming no host e no container (podman), sem processos ou /tmp vazando.
- Testado em servidor real: voz e /play funcionam. 403 intermitente do YouTube tratado com retry (P-011). Demais comandos ainda sem teste completo (ver 05).
- Como rodar: `README.md` (seções 1–3). Problemas conhecidos: 04.

## Mapa das salas
| Sala | Leia quando |
|---|---|
| [01-arquitetura](01-arquitetura.md) | for mexer em qualquer código — camadas e fluxo do /play |
| [02-decisoes](02-decisoes.md) | for propor mudança de abordagem — veja o que já foi descartado |
| [03-progresso](03-progresso.md) | quiser saber o que foi feito por último |
| [04-problemas](04-problemas.md) | algo quebrar (yt-dlp, voz, processos) |
| [05-proximos-passos](05-proximos-passos.md) | for escolher a próxima tarefa |
| [06-glossario](06-glossario.md) | precisar de nomes, convenções ou variáveis de ambiente |

**Ordem sugerida:** este arquivo → 03 (últimas entradas) → 01 → a sala relevante à tarefa.

## Mapa do código
`src/index.ts` (bootstrap) · `src/commands/` (um arquivo por comando + `guards.ts` + `playFlow.ts`) · `src/control/` (operações compartilhadas: comandos, botões, painel) · `src/interactions/` (router, botões, /search, autocomplete) · `src/presence.ts` · `src/audio/` (filtros, SponsorBlock) · `src/db/` (SQLite) · `src/player/` (`PlayerManager` → `GuildPlayer` → `Queue`) · `src/youtube/` (`url.ts`, `YouTubeService.ts`, `process.ts`, `errors.ts`) · `src/deploy-commands.ts`.

## Regras de manutenção
- Ler esta sala e as relevantes antes de propor mudanças.
- Ao fim de cada etapa: atualizar 03 e, se aplicável, as demais.
- Decisão não trivial (inclusive aceita/recusada pelo usuário) → 02.
- Erro resolvido após mais de uma tentativa → 04.
- Datas AAAA-MM-DD; conciso; **nunca** registrar segredos.
