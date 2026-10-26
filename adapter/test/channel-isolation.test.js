import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Adapter} from '../src/index.js';
import {MemoryStorage,makeEnv} from './helpers.js';
import {inspectAdapter} from '../../scripts/check-adapter-mcp.mjs';
test('two channel credentials, recipients and persistent auth stops cannot cross scopes',async()=>{
 const storage=new MemoryStorage(), received={alpha:[],beta:[]}, calls=[];
 const request=async(url,init)=>{
  const [, ,channel,op]=new URL(url).pathname.split('/'); calls.push([channel,op]);
  if(init.headers.authorization!==`Bearer fixture-${channel}`)return Response.json({error:'unauthorized'},{status:401});
  if(op==='who')return Response.json({you:'grok',members:[]});
  if(op==='send'){const body=JSON.parse(init.body); received[channel].push(body); return Response.json({id:received[channel].length,delivery:{[body.to]:'queued_offline'}});}
  throw Error('unexpected operation');
 };
 const entries=['alpha','beta'].map(channel=>{
  const env=makeEnv({CCIM_CHANNEL:channel,CCIM_TOKEN:`fixture-${channel}`,MCP_BEARER:`entry-${channel}`,STATE_NAMESPACE:`scope-${channel}`,ALLOWED_RECIPIENTS:channel});
  const adapter=new Adapter({storage},env,{fetch:request,now:()=>123,log:()=>{}});
  const rpc=async(args,bearer=env.MCP_BEARER)=>adapter.fetch(new Request('https://worker.test/mcp',{method:'POST',headers:{authorization:`Bearer ${bearer}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:args})}));
  return {env,adapter,rpc};
 });
 for(const [i,e] of entries.entries()){
  const channel=i?'beta':'alpha';
  assert.equal((await e.rpc({name:'grok_status',arguments:{health:true}},entries[1-i].env.MCP_BEARER)).status,401);
  const send=await (await e.rpc({name:'grok_send',arguments:{to:channel,text:'fixture diagnostic',hop:0,clientId:'same-id-0001'}})).json();
  assert.equal(send.result.structuredContent.outcome,'sent');
  assert.equal(received[channel].length,1);
 }
 entries[0].env.CCIM_TOKEN='fixture-beta';
 await entries[0].rpc({name:'grok_send',arguments:{to:'alpha',text:'fixture',hop:0,clientId:'bad-token-0001'}});
 entries[0].env.CCIM_TOKEN='fixture-alpha';
 const before=structuredClone(storage.map);
 const result=await inspectAdapter({url:'https://worker.test/mcp',bearer:'entry-alpha',probeIdentity:true,request:(url,init)=>entries[0].adapter.fetch(new Request(url,init))});
 assert.equal(result.downstream_auth.blocked,true); assert.equal(result.downstream_auth.ok,true);
 assert.equal(result.identity_probe.source,'worker_bound_identity'); assert.deepEqual(storage.map,before);
 const healthy=await (await entries[1].rpc({name:'grok_status',arguments:{health:true}})).json();
 assert.equal(healthy.result.structuredContent.downstream.ok,true);
 assert.equal(received.alpha.length,1); assert.equal(received.beta.length,1);
 assert.ok(calls.every(([,op])=>['who','send'].includes(op)));
});
