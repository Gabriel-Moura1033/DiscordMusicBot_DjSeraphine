# 00 — Entrada

**O que é:** bot de música para Discord, uso privado (um servidor de amigos). Toca **apenas YouTube** via yt-dlp → ffmpeg → @discordjs/voice. Node 24 + TypeScript strict, discord.js v14, slash commands, fila em memória por guild, Docker.

## Estado atual (2026-10-17)
- Versão 0.1.0 implementada: 12 slash commands, fila por guild, pipeline yt-dlp → ffmpeg com kill limpo, Docker.
- Verificado: typecheck strict, resolução/streaming no host e no container (podman), sem processos ou /tmp vazando.
- **Ainda não testado num servidor Discord real** (conexão de voz, DAVE, comandos). É o próximo passo (ver 05).
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
`src/index.ts` (bootstrap) · `src/commands/` (um arquivo por comando + `guards.ts`) · `src/player/` (`PlayerManager` → `GuildPlayer` → `Queue`) · `src/youtube/` (`url.ts`, `YouTubeService.ts`, `process.ts`, `errors.ts`) · `src/deploy-commands.ts`.

## Regras de manutenção
- Ler esta sala e as relevantes antes de propor mudanças.
- Ao fim de cada etapa: atualizar 03 e, se aplicável, as demais.
- Decisão não trivial (inclusive aceita/recusada pelo usuário) → 02.
- Erro resolvido após mais de uma tentativa → 04.
- Datas AAAA-MM-DD; conciso; **nunca** registrar segredos.
