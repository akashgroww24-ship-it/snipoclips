# Snipoclips — production image WITH ffmpeg + yt-dlp
FROM node:22-bookworm-slim

# System tools used by the clip pipeline and the YouTube POT provider.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates curl git python3 python3-pip python3-opencv \
      fonts-dejavu-core fonts-noto-core fonts-noto-color-emoji fonts-indic fontconfig \
 && fc-cache -f \
 && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# yt-dlp / YouTube hardening
# - pre-release/nightly yt-dlp picks up YouTube extractor fixes quickly
# - yt-dlp[default] installs the EJS challenge solver
# - bgutil provides per-video Proof-of-Origin tokens, which is the current
#   recommended path when YouTube challenges a hosting-provider/datacenter IP
# - the provider script lives in root's default discovery location so yt-dlp
#   can invoke it automatically without running a second public service
# ---------------------------------------------------------------------------
RUN pip3 install --break-system-packages --no-cache-dir --upgrade --pre \
      "yt-dlp[default]" \
      "bgutil-ytdlp-pot-provider==2.0.0" \
 && git clone --depth 1 --branch 2.0.0 \
      https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git \
      /root/bgutil-ytdlp-pot-provider \
 && cd /root/bgutil-ytdlp-pot-provider/server \
 && npm ci \
 && npx tsc \
 && node --version \
 && yt-dlp --version \
 && printf '%s\n' \
      '--js-runtimes' \
      'node' \
      '--extractor-args' \
      'youtube:player_client=default,mweb' \
      > /etc/yt-dlp.conf

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

# Keep the Reel Composer as separate bundles, but expose them directly inside
# the existing /app dashboard without duplicating the large dashboard document.
RUN python3 - <<'PY'
from pathlib import Path
p = Path('/app/public/app/index.html')
s = p.read_text()
tags = [
    '<script src="reel-integrated.js"></script>',
    '<script src="reel-layout-fix.js"></script>',
]
if '</body>' not in s:
    raise SystemExit('dashboard index.html has no </body> tag')
for tag in tags:
    if tag not in s:
        s = s.replace('</body>', tag + '\n</body>')
p.write_text(s)
PY

ENV NODE_ENV=production
ENV PORT=8080
ENV TMP_DIR=/tmp/snipoclips
EXPOSE 8080
CMD ["node", "server.js"]
