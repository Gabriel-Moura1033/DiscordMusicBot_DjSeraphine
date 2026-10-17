# DJ — bot de música para Discord

Bot privado que toca **apenas YouTube** (vídeo, shorts, music.youtube.com, playlist ou busca por texto) em canais de voz. Node 24 + TypeScript, discord.js v14, yt-dlp → ffmpeg → @discordjs/voice, rodando em Docker.

Contexto do projeto, decisões e problemas conhecidos: [`docs/memoria/00-entrada.md`](docs/memoria/00-entrada.md).

## Comandos

| Comando | O que faz |
|---|---|
| `/play musica:<link ou nome>` | Toca/enfileira um vídeo, uma playlist (até `MAX_PLAYLIST_SIZE`) ou o 1º resultado da busca. Ao digitar, sugere títulos (autocomplete) |
| `/playnow musica:<link ou nome>` | Pula a faixa atual e toca a pedida na hora; o resto da fila continua igual |
| `/search musica:<nome>` | Mostra os 5 primeiros resultados num menu; quem buscou escolhe em até 60 s |
| `/skip` `/stop` `/pause` `/resume` | Controle da reprodução (`/stop` limpa a fila mas mantém o bot no canal) |
| `/skipto posicao:<n>` | Pula direto para a posição `n` da fila (como vários `/skip`; no loop de fila as puladas vão para o fim) |
| `/previous` | Volta para a faixa anterior; a atual vai para o início da fila |
| `/replay` | Recomeça a faixa atual |
| `/seek tempo:<mm:ss\|hh:mm:ss>` | Vai para um ponto da faixa atual (leva ~2–7 s; a música continua tocando até lá) |
| `/queue` | Fila paginada (10 por página) |
| `/nowplaying` | Faixa atual com barra de progresso e botões de controle |
| `/remove posicao:<n>` `/move de:<n> para:<n>` `/shuffle` `/loop modo:<desligado\|faixa\|fila>` | Edição da fila |
| `/clear` | Limpa a fila sem parar a faixa atual |
| `/filtro tipo:<nenhum\|bassboost\|nightcore\|8d>` | Efeito de áudio, salvo por servidor; aplica na posição atual (~2–3 s) |
| `/autoplay` | Liga/desliga: quando a fila acaba, segue com músicas do mix do YouTube da última faixa (aparecem como "Recomendado pela DJ Seraphine") |
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

## Testes

```bash
npm test            # vitest run (também roda no build da imagem; falha = imagem não gerada)
npm run test:watch
npm run typecheck   # tsc sobre src/ e test/
```

Os testes são **puros**: um setup global faz `spawn`/`exec` e `fetch` lançarem erro, então nada depende de rede, yt-dlp, ffmpeg ou YouTube.

## Operação

- **Healthcheck:** o bot grava `HEARTBEAT_FILE` a cada 15 s enquanto o gateway do Discord está conectado; o container fica `unhealthy` se o arquivo ficar mais de 60 s sem atualizar (`docker compose ps`).
- **Queda do gateway:** se o gateway ficar fora por mais de `GATEWAY_DOWN_EXIT_MINUTES` (padrão 5), o processo encerra com código 1 e o `restart: unless-stopped` sobe outro. A detecção da queda em si leva ~1–2 min (heartbeat do Discord), então o tempo total é o valor configurado + ~2 min.
- **Shutdown:** `docker compose stop` sai dos canais de voz, encerra yt-dlp/ffmpeg (espera até 5 s), fecha o gateway e sai com 0. Um segundo sinal força a saída.

## Interface no chat

- **Botões** ⏯️ ⏭️ 🔁 ⏹️ aparecem no aviso "tocando agora", na resposta do `/play` que começa a tocar na hora e no `/nowplaying`. Valem as mesmas regras dos comandos: só quem está no canal de voz do bot. 🔁 cicla off → faixa → fila. Quando a faixa termina, os botões daquela mensagem são desativados.
- **Autocomplete do `/play`:** a partir de 3 letras sugere até 5 vídeos (a sugestão escolhida vira o link). Cada sugestão é uma busca no YouTube; resultados ficam em cache por `AUTOCOMPLETE_CACHE_TTL_SECONDS`. Se a busca demorar, a lista vem vazia e você pode mandar o texto mesmo assim.
- **Autoplay:** com `/autoplay` ligado, quando começa a última faixa da fila o bot já escolhe a próxima no mix do YouTube dela (sem repetir o que tocou recentemente nem outra versão da mesma música). Se você pedir algo nesse meio tempo, sua música vem primeiro. `/stop` não aciona o autoplay; o bot ainda sai se ficar sozinho no canal.
- **Qualidade de áudio:** volume normalizado (`loudnorm`), próxima faixa pré-carregada 20 s antes do fim (sem silêncio entre músicas) e trechos sem música dos clipes (intros, falas) pulados via [SponsorBlock](https://sponsor.ajay.app) — a consulta envia só um prefixo do hash do ID do vídeo. Cada um pode ser desligado no `.env`.
- **Presença:** o bot mostra "Ouvindo <título>". Em mais de um servidor, mostra a faixa que começou por último; pausar não muda.

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
| `/seek` responde "Não consegui reabrir o áudio" | yt-dlp falhou ao abrir o stream na nova posição (já tenta 3×) | A música segue de onde estava; tente de novo. Veja `seek failed` no log |
| "🤖 Autoplay: não achei uma próxima faixa" | O mix da última faixa não tem nada que ainda não tenha tocado, ou o YouTube recusou a busca | Use `/play`; o autoplay segue a partir da nova faixa. Veja `autoplay:` no log |
| Autoplay repete o mesmo artista | O mix do YouTube é montado em torno da faixa-semente | Normal; peça uma música de outro estilo e o autoplay segue a partir dela |
| Música começa ~2 s depois e "reinicia" um pouco à frente | Primeira vez que o vídeo toca: os cortes do SponsorBlock chegam depois do início e o stream é reaberto já com eles | Normal; nas próximas vezes (cache) e na pré-carga não acontece. `SPONSORBLOCK_ENABLED=false` desliga |
| Trecho de música foi pulado por engano | Corte do SponsorBlock errado (enviado pela comunidade) | `SPONSORBLOCK_ENABLED=false`, ou corrija o trecho no site do SponsorBlock |
| `sponsorblock lookup failed` no log | API fora ou lenta (> 1,5 s) | Nada: a faixa toca sem cortes |
| Barulho/distorção com bass boost | Ganho de grave alto em faixas já com muito grave | `/filtro tipo:nenhum` |
| `/seek` demora | O áudio até o ponto pedido é baixado e descartado (ADR-035); em vídeos longos chega a ~7 s | Normal; a faixa continua tocando enquanto isso |
| Busca retorna o vídeo errado | `ytsearch1` pega só o 1º resultado | Use `/search` para escolher, o autocomplete do `/play`, ou o link direto |
| Autocomplete não sugere nada | Texto com menos de 3 letras, link, busca lenta (> ~2 s) ou `AUTOCOMPLETE_ENABLED=false` | Digite mais um pouco (a busca segue em segundo plano e a próxima tecla usa o cache) ou envie o texto: o `/play` busca do mesmo jeito |
| `Sign in to confirm you're not a bot` aparece depois de ativar o autocomplete | Cada tecla pode virar uma busca no YouTube a partir do seu IP | `AUTOCOMPLETE_ENABLED=false` e rode o deploy de comandos de novo |

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
| Bot diz que está tocando, mas não está no canal / ficou mudo minutos | Host entrou em suspensão (sleep) e a conexão de voz caiu | Rode em máquina que não suspende, ou bloqueie o sleep enquanto o bot roda: `systemd-inhibit --what=sleep:idle --why="bot de música" sleep infinity` |
| Slash commands não aparecem | Comandos não registrados, guild errada ou convite sem `applications.commands` | Rode o deploy de novo, confira `DISCORD_GUILD_ID`, reconvide com o link acima e recarregue o Discord (Ctrl+R) |
| "Comando desconhecido" | Registro desatualizado | Rode o deploy de comandos de novo |
| Botões desativados / "Esses controles são de uma faixa que já terminou" | A faixa da mensagem acabou ou o bot reiniciou | Use os botões da mensagem mais recente ou `/nowplaying` |
| "⌛ Essa busca expirou" | O menu do `/search` vale 60 s | Faça a busca de novo |
| Áudio picotando | CPU do host saturada | Verifique `docker stats`; a codificação Opus roda no processo Node |

### Container e operação

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `docker compose ps` mostra `unhealthy` | Gateway desconectado (rede, Discord fora) ou processo travado | Veja `docker compose logs dj` (`gateway not ready`); se passar de `GATEWAY_DOWN_EXIT_MINUTES` o processo reinicia sozinho |
| Container reiniciando em loop | Token inválido, rede sem acesso ao Discord, ou config inválida (`[config] ...` no log) | Corrija o `.env`; com rede fora, cada ciclo dura `GATEWAY_DOWN_EXIT_MINUTES` |
| Podman não mostra status de saúde | Podman ignora `HEALTHCHECK` em imagens OCI | O `docker-compose.yml` já repete o check; `podman healthcheck run dj` roda manualmente |
| `docker build` falha em `npm test` | Teste quebrado | Rode `npm test` localmente para ver qual |

### Processos

Para conferir que não sobram processos do yt-dlp/ffmpeg após `/skip` ou `/stop`:

```bash
docker compose top dj
```

Deve aparecer só `node` (e, enquanto toca, um `yt-dlp` com seu processo filho e um `ffmpeg`).
