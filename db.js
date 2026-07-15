// lib/db.js
// Minimal JSON-file data store. Survives redeploys when DATA_DIR points OUTSIDE
// the project folder (same pattern you use for Manav Dharma's mds-data).
// Swap these functions for Postgres/Mongo later without touching the routes.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

function file(name) { return path.join(DATA_DIR, name + '.json'); }

function read(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); }
  catch { return fallback; }
}

function write(name, value) {
  // atomic-ish write: write temp then rename
  const tmp = file(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file(name));
  return value;
}

// Seed the store on first run from the bundled sample, so the dashboard
// has something to show immediately. Delete the seed once real data flows in.
function ensureSeed() {
  if (!fs.existsSync(file('metrics'))) {
    try {
      const seed = require('../data/seed.json');
      write('metrics', seed);
    } catch { /* no seed available */ }
  }
}

module.exports = { read, write, ensureSeed, DATA_DIR };
