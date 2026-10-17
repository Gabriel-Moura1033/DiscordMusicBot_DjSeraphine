# DJ — bot de música para Discord

Bot privado que toca **apenas YouTube** (vídeo, shorts, music.youtube.com, playlist ou busca por texto) em canais de voz. Node 24 + TypeScript, discord.js v14, yt-dlp → ffmpeg → @discordjs/voice, rodando em Docker.

Contexto do projeto, decisões e problemas conhecidos: [`docs/memoria/00-entrada.md`](docs/memoria/00-entrada.md).

## Comandos

| Comando | O que faz |
|---|---|
| `/play musica:<link ou nome>` | Toca/enfileira um vídeo, uma playlist (até `MAX_PLAYLIST_SIZE`) ou o 1º resultado da busca |
| `/skip` `/stop` `/pause` `/resume` | Controle da reprodução (`/stop` limpa a fila mas mantém o bot no canal) |
| `/queue` | Fila paginada (10 por página) |
| `/nowplaying` | Faixa atual com barra de progresso |
| `/remove posicao:<n>` `/shuffle` `/loop modo:<desligado\|faixa\|fila>` | Edição da fila |
| `/volume nivel:<0-100>` | Volume (efeito imediato) |
| `/leave` | Sai do canal e descarta a fila |

Só quem está no mesmo canal de voz do bot consegue controlá-lo; `/queue` e `/nowplaying` funcionam para todos. O bot sai sozinho após `IDLE_TIMEOUT_SECONDS` (padrão 5 min) com a fila vazia ou sem ninguém no canal.

## 1. Criar a aplicação no Discord

1. Acesse <https://discord.com/developers/applications> → **New Application**.
2. **General Information**: copie o **Application ID** (`DISCORD_CLIENT_ID`).
3. **Installation**: em *Install Link* escolha **None** (bot privado).
4. **Bot**:
   - **Reset Token** e copie (`DISCORD_TOKEN`). Nunca versione esse valor.
   - Desative **Public Bot**.
   - **Privileged Gateway Intents**: deixe todas **desligadas**. O bot usa só `Guilds` e `GuildVoiceStates`, que não são privilegiadas.
5. No Discord, ative *Configurações → Avançado → Modo desenvolvedor*, clique com o botão direito no servidor → **Copiar ID** (`DISCORD_GUILD_ID`).

### Link de convite

Escopos `bot` + `applications.commands`. Permissões: View Channels, Send Messages, Embed Links, Connect, Speak (= `3165184`).

```
https://discord.com/oauth2/authorize?client_id=SEU_CLIENT_ID&scope=bot+applications.commands&permissions=3165184
```

## 2. Rodar com Docker (ou Podman)

```bash
cp .env.example .env          # preencha DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID
docker compose build

# registra os slash commands na guild (instantâneo); repita ao adicionar/alterar comandos
docker compose run --rm -e YTDLP_AUTO_UPDATE=false dj node dist/deploy-commands.js

docker compose up -d
docker compose logs -f
```

Com Podman, troque `docker compose` por `podman compose`.

A cada start do container o entrypoint roda `yt-dlp --update-to stable`. Se falhar, registra um aviso e sobe com a versão atual. Desligue com `YTDLP_AUTO_UPDATE=false`.

## 3. Rodar sem Docker (desenvolvimento)

Requer Node ≥ 24, `ffmpeg`, `yt-dlp` e `deno` no `PATH`.

```bash
npm ci
npm run deploy:dev   # registra os comandos
npm run dev          # tsx watch, logs com pino-pretty
```

Build de produção: `npm run build && npm start`.

## Variáveis de ambiente

Veja [`.env.example`](.env.example). Obrigatórias: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`. Valores inválidos fazem o bot recusar a subir com uma mensagem `[config] ...`.

## Troubleshooting

### yt-dlp

| Sintoma (log ou mensagem no chat) | Causa provável | O que fazer |
|---|---|---|
| `Requested format is not available`, `nsig extraction failed`, `HTTP Error 403`, "o yt-dlp não conseguiu extrair o áudio" | yt-dlp desatualizado após mudança no YouTube | `docker compose restart` (atualiza no start). Se o update falhar: `docker compose build --no-cache` |
| Aviso `[entrypoint] AVISO: falha ao atualizar o yt-dlp` | Sem acesso a `api.github.com` / rate limit do GitHub | O bot segue com a versão atual; tente reiniciar mais tarde |
| `Sign in to confirm you're not a bot`, `HTTP Error 429` | IP marcado pelo YouTube (comum em VPS/datacenter) ou excesso de requisições | Aguarde algumas horas; rode em IP residencial. O projeto não usa cookies (decisão ADR-014) |
| `Sign in to confirm your age` | Vídeo com restrição de idade | Sem cookies não há como tocar; o bot pula e avisa |
| Desafios JS / `No supported JavaScript runtime` | Deno ausente | `docker compose exec dj deno --version`; a imagem já inclui |
| Busca retorna o vídeo errado | `ytsearch1` pega só o 1º resultado | Use o link direto |

Para depurar um vídeo manualmente:

```bash
docker compose exec dj yt-dlp -v -F "https://www.youtube.com/watch?v=ID"
```

### Conexão de voz

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| "Não consegui conectar ao canal de voz (tempo esgotado)" | UDP de saída bloqueado (firewall, VPN, rede corporativa) | Libere UDP de saída; teste sem VPN |
| Bot entra, mas ninguém ouve | Protocolo E2EE DAVE sem suporte, ou opus ausente | Confirme `@discordjs/voice` ≥ 0.19; rode com `LOG_LEVEL=debug` e veja o *dependency report* no log |
| Bot sai sozinho logo após entrar | Expulso ou movido (código 4014), ou canal apagado | Normal: ele tenta reconectar por 5 s e depois encerra a sessão da guild |
| "Não tenho permissão para entrar e falar" | Falta Connect/Speak/View Channel no canal | Ajuste as permissões do cargo do bot no canal |
| Slash commands não aparecem | Comandos não registrados, guild errada ou convite sem `applications.commands` | Rode o deploy de novo, confira `DISCORD_GUILD_ID`, reconvide com o link acima e recarregue o Discord (Ctrl+R) |
| "Comando desconhecido" | Registro desatualizado | Rode o deploy de comandos de novo |
| Áudio picotando | CPU do host saturada | Verifique `docker stats`; a codificação Opus roda no processo Node |

### Processos

Para conferir que não sobram processos do yt-dlp/ffmpeg após `/skip` ou `/stop`:

```bash
docker compose top dj
```

Deve aparecer só `node` (e, enquanto toca, um `yt-dlp` com seu processo filho e um `ffmpeg`).
