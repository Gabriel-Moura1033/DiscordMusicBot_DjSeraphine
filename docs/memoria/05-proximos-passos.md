# 05 — Próximos passos

## Leva de funcionalidades (fases aprovadas em 2026-10-17)
- [x] Fase 1 — Testes e operação
- [x] Fase 2 — Interface no chat (botões, /search, autocomplete, presença) — falta teste no Discord
- [x] Fase 3 — Comandos de fila (/move, /skipto, /clear, histórico, /previous, /replay, /seek) — falta teste no Discord
- [x] Fase 4 — Autoplay — falta teste no Discord
- [x] Fase 5 — Qualidade de áudio (loudnorm, pré-carga, SponsorBlock, /filtro) — falta teste no Discord
- [x] Fase 6 — Persistência SQLite (adiada e retomada em 2026-10-17) — falta teste no Discord
- [x] Fase 7a — Camada de controle compartilhada (sem mudança de comportamento)
- [x] Fase 7b — Painel web local — falta validar no navegador/Discord

## Prioridade alta
- [ ] Testar ponta a ponta num servidor real (play/skip/stop/leave, playlist, vídeo privado, idade, timer de inatividade, /queue paginado)
- [ ] Testar no Discord o que só foi validado no container:
  - Fase 2: botões fora do canal (deve recusar), ⏭️/🔁, expiração do menu do /search, presença mudando entre faixas
  - Fase 3: /seek, /replay, /previous com áudio real
  - Fase 4: autoplay sem silêncio entre faixas, /stop não continua, bot sai sozinho com autoplay ligado
  - Fase 5: transição com pré-carga, filtros de ouvido, intro de clipe pulada
  - Fase 7: login no navegador, logs ao vivo durante /play, controles do painel × slash commands sem divergência de fila, mensagem pelo painel chegando sem pingar
  - Fase 6: reiniciar o container com fila tocando e dar /play (aviso + ordem), /top, /playlist salvar/carregar com autocomplete
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
