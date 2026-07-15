// scripts/check.js — run with: npm run check
require('dotenv').config();
const { execSync } = require('child_process');

const G = '\x1b[32m✓\x1b[0m', R = '\x1b[31m✗\x1b[0m', Y = '\x1b[33m!\x1b[0m';

function env(k){ return !!process.env[k] && !/x{3,}|replace|YOUR/i.test(process.env[k]); }
function bin(cmd){ try { execSync(`${cmd} -version`, { stdio: 'ignore' }); return true; } catch { return false; } }

console.log('\n  Snipoclips — setup check\n  ------------------------');

const groups = {
  'Server':    [['PORT', env('PORT')||true], ['ALLOWED_ORIGINS', env('ALLOWED_ORIGINS')]],
  'Admin':     [['ADMIN_EMAIL', env('ADMIN_EMAIL')], ['ADMIN_PASSWORD_HASH', env('ADMIN_PASSWORD_HASH')], ['JWT_SECRET', env('JWT_SECRET')]],
  'Supabase':  [['SUPABASE_URL', env('SUPABASE_URL')], ['SUPABASE_ANON_KEY', env('SUPABASE_ANON_KEY')], ['SUPABASE_SERVICE_ROLE_KEY', env('SUPABASE_SERVICE_ROLE_KEY')]],
  'AI keys':   [['ANTHROPIC_API_KEY', env('ANTHROPIC_API_KEY')], ['GROQ_API_KEY', env('GROQ_API_KEY')]],
};
let missing = 0;
for (const [name, items] of Object.entries(groups)) {
  console.log(`\n  ${name}`);
  for (const [k, ok] of items) { if (!ok) missing++; console.log(`   ${ok ? G : R} ${k}`); }
}

console.log('\n  System binaries (install on the server)');
const ff = bin(process.env.FFMPEG_PATH || 'ffmpeg');
const yt = (() => { try { execSync(`${process.env.YTDLP_PATH || 'yt-dlp'} --version`, { stdio: 'ignore' }); return true; } catch { return false; } })();
console.log(`   ${ff ? G : R} ffmpeg ${ff ? '' : '— install:  sudo apt install ffmpeg'}`);
console.log(`   ${yt ? G : Y} yt-dlp ${yt ? '' : '— optional (for URL imports):  pip install yt-dlp'}`);

console.log('\n  ------------------------');
if (missing === 0 && ff) console.log('  ' + G + ' Ready to start:  npm start\n');
else console.log('  ' + Y + ` ${missing} item(s) missing. Fill them in .env, then re-run: npm run check\n`);
