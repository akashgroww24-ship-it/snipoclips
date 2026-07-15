# Snipoclips — production image WITH ffmpeg + yt-dlp (the thing managed hosting lacks)
FROM node:22-bookworm-slim

# system tools the clip pipeline needs
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates curl python3 python3-opencv fonts-dejavu-core fonts-noto-core fonts-noto-color-emoji fonts-indic fontconfig \
 && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && fc-cache -f \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production
ENV PORT=8080
ENV TMP_DIR=/tmp/snipoclips
EXPOSE 8080
CMD ["node", "server.js"]
