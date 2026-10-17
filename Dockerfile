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

# ---------- build TypeScript ----------
FROM deps AS build
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

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

USER node
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
