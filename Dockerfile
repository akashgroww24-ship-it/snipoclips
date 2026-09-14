# Snipoclips — production image WITH ffmpeg + yt-dlp (the thing managed hosting lacks)
FROM node:22-bookworm-slim

# system tools the clip pipeline needs
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates curl python3 python3-pip python3-opencv \
      fonts-dejavu-core fonts-noto-core fonts-noto-color-emoji fonts-indic fontconfig \
 && fc-cache -f \
 && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# yt-dlp / YouTube hardening
# YouTube changes frequently break the monthly stable yt-dlp release. Upstream
# explicitly recommends the nightly channel when stable is failing. The default
# extras include yt-dlp-ejs, and Node 22 is the JS runtime used for challenge
# solving. For current 2026 player-response failures, retry-capable YouTube
# clients are enabled globally; the app's own format selector still prefers the
# highest source quality and falls back to a combined format when needed.
# ---------------------------------------------------------------------------
RUN pip3 install --break-system-packages --no-cache-dir --upgrade --pre \
      "yt-dlp[default]" \
 && node --version \
 && yt-dlp --version \
 && printf '%s\n' \
      '--js-runtimes' \
      'node' \
      '--extractor-args' \
      'youtube:player_client=default,web_embedded' \
      > /etc/yt-dlp.conf

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production
ENV PORT=8080
ENV TMP_DIR=/tmp/snipoclips
EXPOSE 8080
CMD ["node", "server.js"]
