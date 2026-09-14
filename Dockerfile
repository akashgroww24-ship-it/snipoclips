# Snipoclips — production image WITH ffmpeg + yt-dlp (the thing managed hosting lacks)
FROM node:22-bookworm-slim

# system tools the clip pipeline needs
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates curl python3 python3-pip python3-opencv \
      fonts-dejavu-core fonts-noto-core fonts-noto-color-emoji fonts-indic fontconfig \
 && fc-cache -f \
 && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# yt-dlp
# Installed via pip with the default extras, which include yt-dlp-ejs. YouTube
# now requires an external JS runtime for robust extraction; Node 22 is already
# provided by the base image, so explicitly enable it. The YouTube-specific
# player client fallback works around current extractor breakage without
# changing behavior for Vimeo/direct URLs/etc.
# ---------------------------------------------------------------------------
RUN pip3 install --break-system-packages --no-cache-dir --upgrade \
      "yt-dlp[default]" \
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
