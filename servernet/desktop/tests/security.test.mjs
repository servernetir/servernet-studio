// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ORIGIN, signinOptions, internal, external, browserApproval, sessionCookie, conversationExport} from '../src/policy.mjs';
import {signIn} from '../src/signin.mjs';

test('navigation accepts only the Studio origin and exact sign-in choices',()=>{
  for(const target of ['javascript:alert(1)','file:///etc/passwd','http://studio.servernet.cloud/','https://studio.servernet.cloud.evil.test/','https://studio.servernet.cloud@evil.test/']) {
    assert.equal(internal(target),false);assert.equal(external(target),false);assert.equal(signinOptions(target),null);
  }
  assert.equal(internal(ORIGIN+'/'),true);
  assert.equal(internal(ORIGIN+'/auth/callback?code=stolen'),false);
  assert.equal(internal(ORIGIN+'/api/session'),false);
  assert.deepEqual(signinOptions(ORIGIN+'/auth/start?lang=tr&method=google'),{lang:'tr',method:'google',theme:'dark'});
  assert.deepEqual(signinOptions(ORIGIN+'/auth/start?lang=fa&theme=light'),{lang:'fa',method:'account',theme:'light'});
  assert.equal(signinOptions(ORIGIN+'/auth/start?method=../admin'),null);
  assert.equal(signinOptions(ORIGIN+'/auth/start?lang=de'),null);
});
test('external windows are confined to the reviewed ServerNet destinations',()=>{
  assert.equal(external('https://console.servernet.cloud/en/account/topup'),true);
  assert.equal(external('https://servernet.cloud/studio/download'),true);
  assert.equal(external('https://servernet.cloud/en/ai/models?type=video'),true);
  assert.equal(external('https://servernet.cloud/tr/ai/docs'),true);
  for(const value of ['https://evil.test','https://console.servernet.cloud:444/account','https://console.servernet.cloud/admin','https://servernet.cloud/downloads/evil.exe','https://console.servernet.cloud@evil.test/account'])assert.equal(external(value),false);
});
test('only a fixed Studio conversation export can produce a text filename', () => {
  const id = 'a'.repeat(32);
  const valid = ORIGIN + '/api/conversations/' + id + '/export';
  assert.equal(conversationExport(valid), `servernet-conversation-${id}.txt`);
  for (const value of [valid + '?redirect=1', valid + '#fragment', valid + '.exe',
    valid.replace(id, 'other'), valid.replace(ORIGIN, 'https://evil.test'), ORIGIN + '/api/session']) {
    assert.equal(conversationExport(value), null);
  }
});
test('browser handoff cannot substitute another request or destination',()=>{
  const id='a'.repeat(43), good=ORIGIN+'/auth/desktop?request_id='+id;
  assert.equal(browserApproval(good,id),true);
  assert.equal(browserApproval(good,'b'.repeat(43)),false);
  assert.equal(browserApproval(good+'&redirect_uri=https://evil.test',id),false);
  assert.equal(browserApproval(good.replace(ORIGIN,'https://evil.test'),id),false);
});
test('session cookies reject other origins, names, expired and oversized lifetimes',()=>{
  const good={origin:ORIGIN,cookie_name:'__Host-servernet-studio',cookie_value:'a'.repeat(43),expires_at:1100};
  const actual=sessionCookie(good,1000);
  assert.equal(actual.httpOnly,true);assert.equal(actual.secure,true);assert.equal(actual.sameSite,'lax');assert.equal(actual.domain,undefined);
  for(const override of [{origin:'https://evil.test'},{cookie_name:'admin'},{cookie_value:'x'},{expires_at:999},{expires_at:1000000}])assert.throws(()=>sessionCookie({...good,...override},1000));
});

function fixture(over={}){
  const calls=[],id='i'.repeat(43);let clock=1000000;
  const io={now:()=>clock,sleep:async(ms)=>{clock+=ms;},
    post:async(path,body)=>{calls.push({path,body});return path.endsWith('/start')?{status:200,data:{request_id:id,user_code:'ABCD-1234',browser_url:ORIGIN+'/auth/desktop?request_id='+id,expires_in:3600,interval:3}}:
      {status:200,data:{origin:ORIGIN,cookie_name:'__Host-servernet-studio',cookie_value:'k'.repeat(43),expires_at:2000}};},
    confirmCode:async()=>true,open:async(value)=>calls.push({open:value}),setCookie:async(cookie)=>calls.push({cookie}),complete:async(value)=>calls.push({complete:value}),...over};
  return {calls,io};
}
test('native handoff uses PKCE and installs the session outside the renderer',async()=>{
  const {calls,io}=fixture();await signIn({lang:'fa',method:'google',theme:'light'},io,new AbortController().signal);
  assert.equal(calls[0].path,'/auth/desktop/start');assert.equal(calls[0].body.challenge.length,43);
  assert.equal(calls[0].body.theme, undefined);
  assert.equal(calls[1].open.startsWith(ORIGIN+'/auth/desktop?'),true);
  assert.equal(calls[2].path,'/auth/desktop/poll');assert.equal(calls[2].body.verifier.length,43);
  assert.equal(calls[3].cookie.httpOnly,true);assert.equal(calls[4].complete,ORIGIN);
  assert.equal(calls.some(x=>JSON.stringify(x).includes('client_secret')),false);
});
test('cancel leaves no native session and never opens a browser',async()=>{
  const {calls,io}=fixture({confirmCode:async()=>false});await signIn({lang:'en',method:'account'},io,new AbortController().signal);
  assert.equal(calls.length,1);
});
test('an expired code or cancelled sign-in does not open the browser', async () => {
  for (const abort of [false, true]) {
    const controller = new AbortController();
    const {calls, io} = fixture();
    io.confirmCode = async () => {
      if (abort) controller.abort();
      else await io.sleep(3600000);
      return true;
    };
    await assert.rejects(signIn({lang: 'en', method: 'account'}, io, controller.signal));
    assert.equal(calls.length, 1);
  }
});
test('invalid server handoff cannot open an arbitrary external URL',async()=>{
  const {calls,io}=fixture();const post=io.post;io.post=async(...args)=>{const r=await post(...args);r.data.browser_url='https://evil.test/';return r;};
  await assert.rejects(signIn({lang:'fa',method:'google'},io,new AbortController().signal));assert.equal(calls.length,1);
});
test('an unverified claimed session cannot be installed',async()=>{
  const {calls,io}=fixture();const post=io.post;io.post=async(...args)=>{const r=await post(...args);if(args[0].endsWith('/poll'))r.data.origin='https://evil.test';return r;};
  await assert.rejects(signIn({lang:'fa',method:'register'},io,new AbortController().signal));assert.equal(calls.some(x=>x.cookie),false);
});
