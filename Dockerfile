# Snipoclips — production image with ffmpeg
FROM node:22-bookworm-slim

# System tools used by the clip pipeline. URL imports are direct video files;
# the image deliberately contains no proxy/PO-token/anti-bot downloader stack.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates curl python3 python3-opencv \
      fonts-dejavu-core fonts-noto-core fonts-noto-color-emoji fonts-indic fontconfig \
 && fc-cache -f \
 && rm -rf /var/lib/apt/lists/*

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
