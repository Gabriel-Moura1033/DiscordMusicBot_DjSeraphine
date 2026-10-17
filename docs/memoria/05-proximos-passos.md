# 05 — Próximos passos

## Prioridade alta
- [ ] Testar ponta a ponta num servidor real (play/skip/stop/leave, playlist, vídeo privado, idade, timer de inatividade, /queue paginado)
- [ ] Confirmar que a voz funciona com DAVE (áudio audível) e registrar em 04 se houver quirk
- [x] Verificar ausência de zumbis após kills em sequência (feito em script no container, 2026-10-17); repetir com o bot real via `docker compose top dj`
- [ ] Testes unitários de `url.ts`, `Queue.ts` e `errors.ts` (node:test, sem dependência extra)
- [ ] Fixar versões de `DENO_IMAGE_TAG` e da imagem Node no Dockerfile para builds reprodutíveis

## Prioridade média
- [ ] `/seek <mm:ss>` (exige reiniciar o pipeline com `--download-sections` ou `-ss` no ffmpeg)
- [ ] Pré-resolver/pré-aquecer a próxima faixa para reduzir silêncio entre músicas
- [ ] `/move <de> <para>` na fila
- [ ] Preservar a fila quando a conexão de voz morre (reconectar o mesmo `GuildPlayer` em vez de destruir) — P-015
- [ ] Se o 403 (P-011) continuar frequente: PO Token provider (plugin bgutil para yt-dlp) no container
- [ ] Healthcheck do container (estado do gateway)

## Ideias futuras
- [ ] Persistir fila em SQLite para sobreviver a restart
- [ ] Normalização de volume (`loudnorm` no ffmpeg)
- [ ] Autocomplete do `/play` com resultados de busca
- [ ] Histórico por guild e `/previous`
