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
    '<script src="help-bot.js"></script>',
    '<script src="promo-access.js"></script>',
]
if '</body>' not in s:
    raise SystemExit('dashboard index.html has no </body> tag')
for tag in tags:
    if tag not in s:
        s = s.replace('</body>', tag + '\n</body>')
p.write_text(s)

# Mount the isolated, authenticated help API without altering the legacy
# clips/jobs router. Fail the build if the server entry point has changed.
server = Path('/app/server.js')
source = server.read_text()
anchor = "app.use('/api', activityRouter);"
mount = "app.use('/api/help', require('./routes/help'));"
if mount not in source:
    if source.count(anchor) != 1:
        raise SystemExit('Could not safely mount help API: expected server router anchor once')
    source = source.replace(anchor, anchor + '\n' + mount)
    server.write_text(source)

admin = Path('/app/public/dashboard.html')
if admin.exists():
    a = admin.read_text()
    for tag in [
        '<script src="admin-users.js"></script>',
        '<script src="admin-music-link.js"></script>',
        '<script src="admin-promos.js"></script>',
    ]:
        if tag not in a and '</body>' in a:
            a = a.replace('</body>', tag + '\n</body>')
    admin.write_text(a)
PY

# Normalize every published HTML page to the SAME homepage logo, including
# pricing, FAQ, guides, blog, account and studio pages. No client-side flicker.
RUN python3 scripts/standardize_brand.py \
 && node --check server.js \
 && node --check routes/promo.js \
 && node --check lib/quota.js \
 && node --check public/admin-promos.js \
 && node --check public/app/promo-access.js

ENV NODE_ENV=production
ENV PORT=8080
ENV TMP_DIR=/tmp/snipoclips
EXPOSE 8080
CMD ["node", "server.js"]
