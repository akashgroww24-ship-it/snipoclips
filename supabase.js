// lib/supabase.js
// Server-side Supabase client using the SERVICE ROLE key.
// This key bypasses Row-Level Security, so it MUST stay on the server only.
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let admin = null;
if (url && serviceKey) {
  admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
} else {
  console.warn('[supabase] not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
}

function ready() { return !!admin; }

module.exports = { admin, ready };
