# syntax=docker/dockerfile:1

ARG NODE_VERSION=24
# Tag da imagem oficial do Deno que contém só o binário (bin, bin-<versão>).
ARG DENO_IMAGE_TAG=bin

FROM docker.io/denoland/deno:${DENO_IMAGE_TAG} AS deno

# ---------- dependências (compila @discordjs/opus) ----------
FROM docker.io/library/node:${NODE_VERSION}-bookworm-slim AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------- testes + build TypeScript ----------
FROM deps AS build
RUN npm ci
COPY tsconfig.json tsconfig.test.json vitest.config.ts ./
COPY src ./src
COPY test ./test
# Testes puros (sem rede/yt-dlp/ffmpeg): se falharem, a imagem não é gerada.
RUN npm run typecheck && npm test && npm run build

# ---------- runtime ----------
FROM docker.io/library/node:${NODE_VERSION}-bookworm-slim AS runtime
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deno /deno /usr/local/bin/deno

# Binário standalone (PyInstaller) em diretório gravável pelo usuário node, para o `yt-dlp -U` funcionar.
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) asset=yt-dlp_linux ;; \
      arm64) asset=yt-dlp_linux_aarch64 ;; \
      *) echo "arquitetura não suportada: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    mkdir -p /opt/yt-dlp; \
    curl -fsSL --retry 3 -o /opt/yt-dlp/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}"; \
    chmod 0755 /opt/yt-dlp/yt-dlp; \
    chown -R node:node /opt/yt-dlp; \
    /opt/yt-dlp/yt-dlp --version

ENV NODE_ENV=production \
    YTDLP_PATH=/opt/yt-dlp/yt-dlp \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    PATH=/opt/yt-dlp:$PATH

WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Banco SQLite (DB_PATH padrão data/dj.sqlite); o compose monta um volume aqui.
RUN mkdir -p /app/data && chown node:node /app/data

USER node

# Heartbeat gravado pelo processo enquanto o gateway está conectado (ADR-029).
# HEARTBEAT_FILE definido e vazio = heartbeat desligado = check sempre ok.
# Obs.: podman ignora HEALTHCHECK em imagens OCI; o docker-compose.yml repete o check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD f="${HEARTBEAT_FILE-/tmp/dj-heartbeat}"; [ -z "$f" ] || { [ -f "$f" ] && [ $(( $(date +%s) - $(stat -c %Y "$f") )) -lt 60 ]; }

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
