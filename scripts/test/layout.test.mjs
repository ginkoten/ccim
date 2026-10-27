import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkLayout} from '../check-channel-layout.mjs';
const example=JSON.parse(readFileSync(new URL('../channel-layout.example.json',import.meta.url)));
test('two channel clean-directory preflight never needs sessions, credentials or network',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'ccim-layout-'));
 try { const file=path.join(dir,'layout.json'); writeFileSync(file,JSON.stringify(example));
 const r=spawnSync(process.execPath,[new URL('../check-channel-layout.mjs',import.meta.url).pathname,file],{env:{HOME:dir},encoding:'utf8'});
 assert.equal(r.status,0); assert.equal(JSON.parse(r.stdout).runtime_verified,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('reject shared homes, sessions, Workers, storage, ports, and bearer variable mappings',()=>{
 for(const k of ['home','session','sessionLink','worker','stateNamespace','bearerEnv','channel']){
 const rows=structuredClone(example); rows[1][k]=rows[0][k]; assert.throws(()=>checkLayout(rows));
 }
 const rows=structuredClone(example); rows.forEach(r=>r.port=3210); assert.throws(()=>checkLayout(rows),/collision_port/);
});
test('reject credentials and malformed/ambiguous paths in a non-secret manifest',()=>{
 for(const change of [{token:'do-not-print'},{relay:'https://user:password@example.invalid'},{home:'/x/../shared'},{recipients:['*']},{sessionLink:'/HOME/.ccim/sessions/wrong.json'}]){
 const rows=structuredClone(example); Object.assign(rows[0],change); assert.throws(()=>checkLayout(rows));
 }
});

test('two clean homes route standard CLI sessions and member tokens only to their own channel',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'ccim-two-homes-'));
 try {
  const mock=path.join(dir,'mock.mjs');
  writeFileSync(mock,`globalThis.fetch=async(url,init)=>{
   const channel=process.env.EXPECT_CHANNEL;
   if(url!=='https://relay.example.invalid/c/'+channel+'/who'||new Headers(init.headers).get('authorization')!=='Bearer fixture-'+channel)throw Error('route_mismatch');
   return Response.json({you:'codex',members:[]});
  };`);
  for(const channel of ['alpha','beta']) {
   const home=path.join(dir,channel);mkdirSync(path.join(home,'sessions'),{recursive:true});
   const file=path.join(home,'sessions',channel+'-session.json');
   const original=JSON.stringify({relay:'https://relay.example.invalid',channel,handle:'codex',token:'fixture-'+channel,host:'codex'});
   writeFileSync(file,original);
   const cli=new URL('../../plugin/bin/ccim',import.meta.url).pathname;
   const env={HOME:dir,CCIM_HOME:home,CCIM_SESSION:channel+'-session',CCIM_HOST:'codex',EXPECT_CHANNEL:channel};
   const r=spawnSync(process.execPath,['--import',mock,cli,'who'],{env,encoding:'utf8'});
   assert.equal(r.status,0,r.stderr);assert.match(r.stdout,new RegExp('channel "'+channel+'"'));assert.doesNotMatch(r.stdout+r.stderr,/fixture-/);
   assert.equal(readFileSync(file,'utf8'),original);
   const wrong=spawnSync(process.execPath,['--import',mock,cli,'who'],{env:{...env,CCIM_SESSION:'missing-session'},encoding:'utf8'});
   assert.notEqual(wrong.status,0);assert.equal(readFileSync(file,'utf8'),original);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
