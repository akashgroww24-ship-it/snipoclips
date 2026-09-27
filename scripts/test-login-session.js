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

async function run(status, recoveryEvent=false) {
  const calls = [];
  const messages = [];
  let signOuts = 0, recoveryShown=0;
  const location = { href: '/login', hash:'' };
  const client = { auth: {
    onAuthStateChange:callback=>{if(recoveryEvent)callback('PASSWORD_RECOVERY',{access_token:'test-token'});return {data:{subscription:{unsubscribe(){}}}};},
    getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
    signOut: async () => { signOuts++; }
  } };
  const ctx = { location, messages, URLSearchParams, msg: message => messages.push(message), nextUrl: () => '/app',
    recoveryMode:false,showRecovery:()=>{recoveryShown++;ctx.recoveryMode=true;},
    window: { supabase: { createClient: () => client } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === '/api/public-config') return { ok: true, json: async () => ({ supabaseUrl:'https://example.supabase.co', supabaseAnonKey:'public-test-key' }) };
      return { ok: status === 200, status };
    }, console };
  vm.runInNewContext('let supa;\n'+sessionCheck, ctx);
  await ctx.check;
  return { calls, messages, signOuts, location, recoveryShown };
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

test('password recovery link shows the reset form instead of redirecting to the app', async () => {
  const r=await run(200,true);
  assert.equal(r.recoveryShown,1);
  assert.equal(r.location.href,'/login');
  assert.equal(r.calls.length,1,'recovery must not trigger the normal session redirect');
});

test('password reset email returns to the recovery form', async () => {
  const start=html.indexOf("$('forgot').onclick=async()=>{");
  const end=html.indexOf("\n$('resetSave').onclick=",start);
  assert.ok(start>=0&&end>start);
  const forgot={};let redirect;
  const ctx={ $:id=>({forgot,email:{value:'person@example.com'}}[id]),
    supa:{auth:{resetPasswordForEmail:async(_email,options)=>{redirect=options.redirectTo;return {error:null};}}},
    location:{origin:'https://snipoclip.com'},msg:()=>{} };
  vm.runInNewContext(html.slice(start,end),ctx);
  await forgot.onclick();
  assert.equal(redirect,'https://snipoclip.com/login');
});

test('valid recovery token updates password then returns to sign-in', async () => {
  const start=html.indexOf("$('resetSave').onclick=async()=>{");
  assert.ok(start>=0);
  const save={disabled:false},newPassword={value:'a-long-new-password'},confirmPassword={value:'a-long-new-password'};
  const resetForm={hidden:false},resetMsg={},box={classList:{remove:()=>{}}};
  let updated,signOuts=0,message;
  const ctx={recoveryMode:true, $:id=>({resetSave:save,newPassword,confirmPassword,resetForm,resetMsg})[id],
    supa:{auth:{updateUser:async attrs=>{updated=attrs;return {error:null};},signOut:async()=>{signOuts++;}}},
    document:{querySelector:()=>box},location:{search:''},
    setMode:()=>{},msg:value=>{message=value;} };
  vm.runInNewContext(html.slice(start,html.indexOf('\n</script>',start)),ctx);
  await save.onclick();
  assert.equal(updated.password,'a-long-new-password');
  assert.equal(signOuts,1);
  assert.equal(resetForm.hidden,true);
  assert.match(message,/Password changed/);
});

test('email signup keeps the confirmation message and sends its link to the studio', async () => {
  const start = html.indexOf("$('submit').onclick=async()=>{");
  const end = html.indexOf("\n$('forgot').onclick=", start);
  assert.ok(start >= 0 && end > start);
  const submit = { onclick:null };
  let message='', request;
  const location = { origin:'https://snipoclip.com', href:'/login' };
  const ctx = { mode:'up', location, console, nextUrl:()=>'/app', _locked:()=>false,
    $:id=>({submit,email:{value:'new@example.com'},pass:{value:'a-password'}}[id]),
    msg:text=>{message=text;},setMode:()=>{message='';},
    supa:{auth:{signUp:async input=>{request=input;return {data:{session:null},error:null};}}} };
  vm.runInNewContext(html.slice(start,end),ctx);
  await submit.onclick();
  assert.equal(request.options.emailRedirectTo,'https://snipoclip.com/app');
  assert.match(message,/Check your email/);
  assert.equal(location.href,'/login');
});

test('existing email signup prompts sign in for an obfuscated user or an explicit duplicate error', async () => {
  const start = html.indexOf("$('submit').onclick=async()=>{");
  const end = html.indexOf("\n$('forgot').onclick=", start);
  for (const response of [
    { data:{user:{identities:[]},session:null},error:null },
    { data:null,error:{code:'user_already_exists',message:'User already registered'} }
  ]) {
    const submit = { onclick:null };
    let prompts=0, message='';
    const ctx = { mode:'up', location:{origin:'https://snipoclip.com',href:'/login'}, console,
      _locked:()=>false, $:id=>({submit,email:{value:'taken@example.com'},pass:{value:'a-password'}}[id]),
      msg:text=>{message=text;}, showExistingAccount:()=>{prompts++;},
      supa:{auth:{signUp:async()=>response}} };
    vm.runInNewContext(html.slice(start,end),ctx);
    await submit.onclick();
    assert.equal(prompts,1);
    assert.equal(ctx.location.href,'/login');
    assert.equal(message,'');
  }
});
