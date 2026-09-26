const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real login-page session check without contacting a live account.
const html = fs.readFileSync(path.join(__dirname, '../public/app/login.html'), 'utf8');
const start = html.indexOf('async function init(){');
const end = html.indexOf('\ninit();', start);
assert.ok(start >= 0 && end > start, 'login session check exists');
const sessionCheck = html.slice(start, end) + '\nglobalThis.check = init();';

async function run(status) {
  const calls = [];
  const messages = [];
  let signOuts = 0;
  const location = { href: '/login' };
  const client = { auth: {
    getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
    signOut: async () => { signOuts++; }
  } };
  const ctx = { location, messages, msg: message => messages.push(message), nextUrl: () => '/app',
    window: { supabase: { createClient: () => client } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === '/api/public-config') return { ok: true, json: async () => ({ supabaseUrl:'https://example.supabase.co', supabaseAnonKey:'public-test-key' }) };
      return { ok: status === 200, status };
    }, console };
  vm.runInNewContext('let supa;\n'+sessionCheck, ctx);
  await ctx.check;
  return { calls, messages, signOuts, location };
}

test('existing session is validated with its bearer token and enters the app', async () => {
  const r = await run(200);
  assert.equal(r.calls[1].url, '/api/me');
  assert.equal(r.calls[1].options.headers.Authorization, 'Bearer test-token');
  assert.equal(r.location.href, '/app');
  assert.equal(r.signOuts, 0);
});

test('temporary server error does not sign a valid session out', async () => {
  const r = await run(503);
  assert.equal(r.signOuts, 0);
  assert.equal(r.location.href, '/login');
  assert.match(r.messages[0], /temporarily unavailable/);
});

test('rejected bearer token signs out the expired session', async () => {
  const r = await run(401);
  assert.equal(r.signOuts, 1);
});
