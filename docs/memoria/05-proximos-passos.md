# 05 — Próximos passos

## Prioridade alta
- [ ] Testar ponta a ponta num servidor real (play/skip/stop/leave, playlist, vídeo privado, idade)
- [ ] Verificar ausência de zumbis após skip em sequência (`ps -ef` no container)
- [ ] Testes unitários de `url.ts`, `Queue.ts` e `errors.ts` (node:test, sem dependência extra)

## Prioridade média
- [ ] `/seek <mm:ss>` (exige reiniciar o pipeline com `--download-sections` ou `-ss` no ffmpeg)
- [ ] Pré-resolver/pré-aquecer a próxima faixa para reduzir silêncio entre músicas
- [ ] `/move <de> <para>` na fila
- [ ] Healthcheck do container (estado do gateway)

## Ideias futuras
- [ ] Persistir fila em SQLite para sobreviver a restart
- [ ] Normalização de volume (`loudnorm` no ffmpeg)
- [ ] Autocomplete do `/play` com resultados de busca
- [ ] Histórico por guild e `/previous`
