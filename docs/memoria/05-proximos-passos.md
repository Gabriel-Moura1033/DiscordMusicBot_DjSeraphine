# 05 — Próximos passos

## Leva de funcionalidades (fases aprovadas em 2026-10-17)
- [x] Fase 1 — Testes e operação
- [x] Fase 2 — Interface no chat (botões, /search, autocomplete, presença) — falta teste no Discord
- [x] Fase 3 — Comandos de fila (/move, /skipto, /clear, histórico, /previous, /replay, /seek) — falta teste no Discord
- [x] Fase 4 — Autoplay — falta teste no Discord
- [x] Fase 5 — Qualidade de áudio (loudnorm, pré-carga, SponsorBlock, /filtro) — falta teste no Discord
- [ ] ~~Fase 6 — Persistência SQLite~~ — **adiada pelo usuário em 2026-10-17**. Plano proposto, se retomada:
  - `node:sqlite` (Node 24.22 traz SQLite 3.53, sem aviso de experimental; sem dependência nativa) × `better-sqlite3` em ADR.
  - `DB_PATH` (padrão `data/dj.sqlite`) em volume `dj-data`; migrações por `PRAGMA user_version` no start.
  - Tabelas `guild_settings`, `queue_items` (espelho a cada 5 s se mudou + no destroy/shutdown), `plays`, `playlists`/`playlist_items`.
  - Restaurar sem reconectar; 1º /play avisa "fila anterior com N faixas restaurada — use /clear para descartar" (ADR-031). Propostas não confirmadas: música pedida toca antes da fila restaurada; autoplay fora do /top do servidor.
  - `/top escopo periodo`, `/playlist salvar|carregar|listar|apagar` com autocomplete; testes com `:memory:`.

## Prioridade alta
- [ ] Testar ponta a ponta num servidor real (play/skip/stop/leave, playlist, vídeo privado, idade, timer de inatividade, /queue paginado)
- [ ] Testar no Discord o que só foi validado no container:
  - Fase 2: botões fora do canal (deve recusar), ⏭️/🔁, expiração do menu do /search, presença mudando entre faixas
  - Fase 3: /seek, /replay, /previous com áudio real
  - Fase 4: autoplay sem silêncio entre faixas, /stop não continua, bot sai sozinho com autoplay ligado
  - Fase 5: transição com pré-carga, filtros de ouvido, intro de clipe pulada
- [ ] Confirmar que a voz funciona com DAVE (áudio audível) e registrar em 04 se houver quirk
- [x] Verificar ausência de zumbis após kills em sequência (feito em script no container, 2026-10-17); repetir com o bot real via `docker compose top dj`
- [x] Testes unitários de `url.ts`, `Queue.ts`, `errors.ts` e `format.ts` (vitest, Fase 1, 2026-10-17)
- [ ] Fixar versões de `DENO_IMAGE_TAG` e da imagem Node no Dockerfile para builds reprodutíveis

## Prioridade média
- [ ] Migrar a paginação do `/queue` para o router global (hoje usa collector de 2 min; funciona, mas é o único que não segue a ADR-030)
- [ ] Preservar a fila quando a conexão de voz morre (reconectar o mesmo `GuildPlayer` em vez de destruir) — P-015
- [ ] Se o 403 (P-011) continuar frequente: PO Token provider (plugin bgutil para yt-dlp) no container
- [x] Healthcheck do container + exit por gateway fora (Fase 1, 2026-10-17)

## Ideias futuras
