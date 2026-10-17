# 05 — Próximos passos

## Leva de funcionalidades (fases aprovadas em 2026-10-17)
- [x] Fase 1 — Testes e operação
- [x] Fase 2 — Interface no chat (botões, /search, autocomplete, presença) — falta teste no Discord
- [x] Fase 3 — Comandos de fila (/move, /skipto, /clear, histórico, /previous, /replay, /seek) — falta teste no Discord
- [ ] Fase 4 — Autoplay
- [ ] Fase 5 — Qualidade de áudio (loudnorm, pré-carga, SponsorBlock, /filtro)
- [ ] Fase 6 — Persistência SQLite

## Prioridade alta
- [ ] Testar ponta a ponta num servidor real (play/skip/stop/leave, playlist, vídeo privado, idade, timer de inatividade, /queue paginado)
- [ ] Confirmar que a voz funciona com DAVE (áudio audível) e registrar em 04 se houver quirk
- [x] Verificar ausência de zumbis após kills em sequência (feito em script no container, 2026-10-17); repetir com o bot real via `docker compose top dj`
- [x] Testes unitários de `url.ts`, `Queue.ts`, `errors.ts` e `format.ts` (vitest, Fase 1, 2026-10-17)
- [ ] Fixar versões de `DENO_IMAGE_TAG` e da imagem Node no Dockerfile para builds reprodutíveis

## Prioridade média
- [ ] Migrar a paginação do `/queue` para o router global (hoje usa collector de 2 min; funciona, mas é o único que não segue a ADR-030)
- [ ] Pré-resolver/pré-aquecer a próxima faixa para reduzir silêncio entre músicas
- [ ] Preservar a fila quando a conexão de voz morre (reconectar o mesmo `GuildPlayer` em vez de destruir) — P-015
- [ ] Se o 403 (P-011) continuar frequente: PO Token provider (plugin bgutil para yt-dlp) no container
- [x] Healthcheck do container + exit por gateway fora (Fase 1, 2026-10-17)

## Ideias futuras
- [ ] Persistir fila em SQLite para sobreviver a restart
- [ ] Normalização de volume (`loudnorm` no ffmpeg)
