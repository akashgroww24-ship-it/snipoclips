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
# - bgutil provides per-video Proof-of-Origin tokens
# - requests are deliberately spaced and retries back off exponentially so a
#   transient 429/throttle does not turn into a burst of repeated requests
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
      '--sleep-requests' \
      '2' \
      '--sleep-interval' \
      '2' \
      '--max-sleep-interval' \
      '5' \
      '--extractor-retries' \
      '2' \
      '--retry-sleep' \
      'extractor:exp=2:20' \
      '--retry-sleep' \
      'http:exp=2:20' \
      '--retry-sleep' \
      'fragment:exp=1:10' \
      > /etc/yt-dlp.conf

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

# Keep feature bundles separate, then expose them inside the existing pages.
RUN python3 - <<'PY'
from pathlib import Path

p = Path('/app/public/app/index.html')
s = p.read_text()
tags = [
    '<script src="reel-integrated.js"></script>',
    '<script src="reel-layout-fix.js"></script>',
    '<script src="music-picker.js"></script>',
    '<script src="music-picker-submit.js"></script>',
    '<script src="activity-heartbeat.js"></script>',
]
if '</body>' not in s:
    raise SystemExit('dashboard index.html has no </body> tag')
for tag in tags:
    if tag not in s:
        s = s.replace('</body>', tag + '\n</body>')
p.write_text(s)

admin = Path('/app/public/dashboard.html')
if admin.exists():
    a = admin.read_text()
    for tag in [
        '<script src="admin-users.js"></script>',
        '<script src="admin-music-link.js"></script>',
    ]:
        if tag not in a and '</body>' in a:
            a = a.replace('</body>', tag + '\n</body>')
    admin.write_text(a)
PY

ENV NODE_ENV=production
ENV PORT=8080
ENV TMP_DIR=/tmp/snipoclips
EXPOSE 8080
CMD ["node", "server.js"]
