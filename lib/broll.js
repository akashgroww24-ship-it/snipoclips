// lib/broll.js — fetch one relevant vertical stock video from Pexels.
// Fully fail-safe: any problem returns null and the clip renders without b-roll.
const fs = require('fs');
const path = require('path');

async function fetchBroll(keyword, outDir, idx) {
  const KEY = process.env.PEXELS_API_KEY;
  if (!KEY || !keyword) return null;
  try {
    const q = encodeURIComponent(String(keyword).slice(0, 60));
    const r = await fetch(`https://api.pexels.com/videos/search?query=${q}&orientation=portrait&per_page=5&size=medium`,
      { headers: { Authorization: KEY } });
    if (!r.ok) return null;
    const data = await r.json();
    for (const v of (data.videos || [])) {
      const files = (v.video_files || []).filter(f => f.file_type === 'video/mp4' && f.link);
      files.sort((a, b) => (b.height || 0) - (a.height || 0));
      const pick = files.find(f => (f.height || 0) <= 1920 && (f.height || 0) >= 600) || files[0];
      if (!pick) continue;
      const dl = await fetch(pick.link);
      if (!dl.ok) continue;
      const out = path.join(outDir, `broll_${idx}.mp4`);
      fs.writeFileSync(out, Buffer.from(await dl.arrayBuffer()));
      return out;
    }
    return null;
  } catch (e) { console.warn('[broll] ' + (e.message || e)); return null; }
}
module.exports = { fetchBroll };
