#!/bin/sh
set -eu

YTDLP="${YTDLP_PATH:-yt-dlp}"

# Atualizar o yt-dlp nunca pode impedir o bot de subir: falha vira aviso.
if [ "${YTDLP_AUTO_UPDATE:-true}" = "true" ]; then
  before="$("$YTDLP" --version 2>/dev/null || echo desconhecida)"
  if output="$(timeout 90 "$YTDLP" --update-to stable 2>&1)"; then
    after="$("$YTDLP" --version 2>/dev/null || echo desconhecida)"
    echo "[entrypoint] yt-dlp: ${before} -> ${after}"
  else
    echo "[entrypoint] AVISO: falha ao atualizar o yt-dlp; seguindo com a versão ${before}" >&2
    printf '%s\n' "$output" | tail -n 5 | sed 's/^/[entrypoint]   /' >&2
  fi
fi

exec "$@"
