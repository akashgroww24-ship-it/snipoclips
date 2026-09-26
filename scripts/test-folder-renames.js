const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the actual rename route with a stubbed database so ownership is verified.
const routes = fs.readFileSync(path.join(__dirname, '../routes/clips.js'), 'utf8');
const start = routes.indexOf("router.patch('/folders/:jobId'");
const end = routes.indexOf('// Caption text for the editor', start);
assert.ok(start >= 0 && end > start, 'folder rename route exists');
const routeSource = routes.slice(start, end);

async function request({ userId = 'owner', name, jobId = 'job-1' }) {
  let handler, saved = null, filters = {};
  const admin = { from: table => {
    assert.equal(table, 'jobs');
    return { update: changes => {
      saved = changes;
      const chain = {
        eq: (key, value) => { filters[key] = value; return chain; },
        select: () => chain,
        maybeSingle: async () => ({ data: filters.id === 'job-1' && filters.user_id === 'owner' ?
          { id:'job-1', folder_name:changes.folder_name } : null, error:null })
      };
      return chain;
    } };
  } };
  vm.runInNewContext(routeSource, { router:{ patch: (_path, _auth, fn) => { handler = fn; } }, requireUser:()=>{}, admin });
  let status = 200, body;
  const res = { status(code){status=code;return this;}, json(value){body=value;return this;} };
  await handler({ user:{id:userId}, params:{jobId}, body:{name} }, res);
  return {status,body,filters,saved};
}

test('owner can save a trimmed folder name', async () => {
  const result = await request({name:'  My best Shorts  '});
  assert.equal(result.status,200);
  assert.equal(result.body.name,'My best Shorts');
  assert.equal(result.filters.user_id,'owner');
});

test('a different user cannot rename the folder', async () => {
  const result = await request({userId:'someone-else',name:'stolen'});
  assert.equal(result.status,404);
  assert.equal(result.filters.user_id,'someone-else');
});

test('empty, multiline, and oversized names are rejected', async () => {
  for (const name of [' ', 'line\nline', 'x'.repeat(81)]) {
    const result = await request({name});
    assert.equal(result.status,400);
    assert.equal(result.saved,null);
  }
});
