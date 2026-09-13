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
# Installed via pip instead of the GitHub binary. YouTube changes its player
# often and the standalone binary goes stale; the pip package resolves the
# newest release at build time, and can be upgraded by redeploying.
# The nightly channel tracks YouTube breakages faster than stable releases.
# ---------------------------------------------------------------------------
RUN pip3 install --break-system-packages --no-cache-dir --upgrade \
      "yt-dlp[default]" \
 && yt-dlp --version

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production
ENV PORT=8080
ENV TMP_DIR=/tmp/snipoclips
EXPOSE 8080
CMD ["node", "server.js"]
