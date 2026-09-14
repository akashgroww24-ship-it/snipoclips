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
# Current YouTube extraction requires an external JS runtime plus yt-dlp-ejs.
# The node:22 base image already supplies a supported Node runtime, but Node is
# not enabled by yt-dlp automatically. Installing the default extras supplies
# the matching EJS challenge solver and the config explicitly enables Node.
# Keep yt-dlp's own default YouTube clients so upstream fixes remain effective.
# ---------------------------------------------------------------------------
RUN pip3 install --break-system-packages --no-cache-dir --upgrade \
      "yt-dlp[default]" \
 && node --version \
 && yt-dlp --version \
 && printf '%s\n' \
      '--js-runtimes' \
      'node' \
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
