import {test} from 'node:test';
import assert from 'node:assert/strict';
import {harness,TOKEN} from './helpers.js';
import {Adapter} from '../src/index.js';
import {tick,ingest} from '../src/core.js';
import {sendReply} from '../src/replies.js';

test('missing fence refuses recovery without spending approval; installing fence permits same approval after restart',async()=>{
 const h=harness({CCIM_TOKEN:'invalid',AUTH_RECHECK_APPROVAL:'review-fence-001'});await h.tick();
 h.env.CCIM_TOKEN=TOKEN;const before=structuredClone(h.storage.map);const calls=h.relay.calls.length;
 for(let i=0;i<2;i++)assert.equal((await h.tick()).auth_recovery.error,'backlog_isolation_required');
 assert.deepEqual(h.storage.map,before);assert.equal(h.relay.calls.length,calls);
 h.env.AUTH_RECHECK_ALLOW_BACKLOG='a-different-approval';assert.equal((await h.tick()).auth_recovery.error,'backlog_isolation_required');
 h.env.BACKLOG_THROUGH_ID='10';const restarted=new Adapter({storage:h.storage},h.env,h.adapter.deps);
 assert.equal((await tick(restarted.ctx())).auth_recovery.ok,true);
 assert.equal((await restarted.ctx().relay.authState()).recovery.approval_id,'review-fence-001');
});
test('explicit old-backlog consent matches this approval; fence conflicts cannot be bypassed',async()=>{
 const h=harness({CCIM_TOKEN:'invalid'});await h.tick();h.env.CCIM_TOKEN=TOKEN;
 h.env.AUTH_RECHECK_APPROVAL='review-old-001';h.env.AUTH_RECHECK_ALLOW_BACKLOG='review-old-001';
 assert.equal((await h.tick()).auth_recovery.ok,true);
 const bad=harness({CCIM_TOKEN:'invalid'});await bad.tick();bad.env.CCIM_TOKEN=TOKEN;
 bad.env.AUTH_RECHECK_APPROVAL='review-bad-001';bad.env.AUTH_RECHECK_ALLOW_BACKLOG='review-bad-001';bad.env.BACKLOG_THROUGH_ID='bad';
 const before=structuredClone(bad.storage.map);assert.equal((await bad.tick()).error,'backlog_fence_conflict');assert.deepEqual(bad.storage.map,before);
});

test('fence persists across restarts and removed config; conflicting or invalid config fails closed',async()=>{
 const h=harness({BACKLOG_THROUGH_ID:'10',CCIM_TOKEN:'invalid'}); await h.tick();
 const before=structuredClone(h.storage.map);const restarted=new Adapter({storage:h.storage},{...h.env,BACKLOG_THROUGH_ID:undefined},h.adapter.deps);
 assert.equal((await restarted.ctx().backlog.status()).through_id,10);
 for(const value of ['11','0','bad']) {const a=new Adapter({storage:h.storage},{...h.env,BACKLOG_THROUGH_ID:value},h.adapter.deps);assert.equal((await tick(a.ctx())).error,'backlog_fence_conflict');}
 assert.deepEqual(h.storage.map,before);
});
test('pending fence blocks business before initialization; concurrent installation is idempotent',async()=>{
 const h=harness({BACKLOG_THROUGH_ID:'2'});
 assert.equal((await h.mcp('grok_inbox')).isError,true);assert.equal(h.relay.calls.length,0);
 const states=await Promise.all([h.adapter.ctx().backlog.initialize(),h.adapter.ctx().backlog.initialize()]);assert.deepEqual(states[0],states[1]);assert.equal((await h.adapter.ctx().backlog.status()).through_id,2);
});
test('old metadata, retries and unreceived late old ids remain untouched; only new messages wake and enter inbox',async()=>{
 const h=harness();h.relay.deliver('claude','grok','old business');
 await ingest(h.adapter.ctx(),[...h.relay.queues.get('grok').values()]);
 await h.storage.put('reply:1:p1',{outcome:'uncertain',clientId:'grok-re-1-p1'});
 const old=structuredClone(h.storage.map);h.env.BACKLOG_THROUGH_ID='2';await h.adapter.ctx().backlog.initialize();
 h.relay.deliver('claude','grok','late old message');h.relay.deliver('claude','grok','new message');
 const result=await h.tick();assert.deepEqual(result.ids,[3]);
 const inbox=(await h.mcp('grok_inbox')).structuredContent.messages;assert.deepEqual(inbox.map(m=>m.id),[3]);
 for(const [k,v]of old)assert.deepEqual(await h.storage.get(k),v);
 assert.equal(await h.storage.get('msg:000000000002'),undefined);
 for(const [tool,args]of [['grok_inbox',{ids:[1,3]}],['grok_reply',{reply_to_id:1,text:'reply'}],['grok_ack',{ids:[1,3]}],['grok_send',{to:'claude',text:'reply',hop:1,source_message_id:1,clientId:'old-source-001'}],['grok_send',{to:'claude',text:'reply',hop:1,clientId:'no-source-001'}]])assert.equal((await h.mcp(tool,args)).isError,true);
 assert.equal(h.relay.calls.filter(c=>['ack','send'].includes(c.op)).length,0);
 assert.equal(h.relay.queues.get('grok').has(1),true);assert.equal(h.relay.queues.get('grok').has(2),true);
 const meta=await h.storage.get('msg:000000000001');assert.equal((await sendReply(h.adapter.ctx(),meta,{part:2,text:'no',hop:1,clientId:'grok-re-1-p2'})).reason,'backlog_quarantined');
 assert.equal((await h.mcp('grok_ack',{ids:[3]})).isError,undefined);assert.equal(h.relay.queues.get('grok').has(3),false);
 for(const [k,v]of old)assert.deepEqual(await h.storage.get(k),v);
});
test('approved auth recovery with fence wakes no old backlog and preserves accepted/uncertain send records',async()=>{
 const h=harness();await h.mcp('grok_send',{to:'claude',text:'accepted',hop:0,clientId:'accepted-old-001'});
 const before=structuredClone(h.storage.map);h.relay.deliver('claude','grok','old');h.env.CCIM_TOKEN='invalid';h.env.BACKLOG_THROUGH_ID='20';await h.tick();
 h.env.CCIM_TOKEN=TOKEN;h.env.AUTH_RECHECK_APPROVAL='approved-isolation-001';assert.equal((await h.tick()).auth_recovery.ok,true);assert.equal((await h.tick()).woke,false);
 assert.equal(h.webhook.calls.length,0);assert.equal(h.relay.queues.get('grok').size,1);
 for(const[k,v]of before)assert.deepEqual(await h.storage.get(k),v);
});
test('full unordered batch and delayed old ids cannot cross fence; corrupt fence fails closed',async()=>{
 const h=harness({BACKLOG_THROUGH_ID:'200'});await h.adapter.ctx().backlog.initialize();
 for(let i=0;i<201;i++)h.relay.deliver('claude','grok','fixture');
 const result=await h.tick();assert.deepEqual(result.ids,[201]);assert.equal(h.relay.queues.get('grok').size,201);
 const restarted=new Adapter({storage:h.storage},h.env,h.adapter.deps);const seen=await restarted.ctx().relay.peek();assert.deepEqual(seen.messages.map(m=>m.id),[201]);
 const saved=await h.storage.get('backlog:fence:v1');await h.storage.put('backlog:fence:v1',{...saved,through_id:null});
 const n=h.relay.calls.length;assert.equal((await tick(restarted.ctx())).error,'backlog_fence_conflict');assert.equal(h.relay.calls.length,n);
});
test('operator hold stops restored cron and all business calls without changing ledgers',async()=>{
 const h=harness({BACKLOG_THROUGH_ID:'1'});await h.adapter.ctx().backlog.initialize();h.env.BACKLOG_HOLD='on';
 const before=structuredClone(h.storage.map);assert.equal((await h.tick()).error,'backlog_operator_hold');
 for(const[name,args]of [['grok_inbox',{}],['grok_send',{to:'claude',hop:0,text:'no',clientId:'hold-send-001'}],['grok_ack',{ids:[2]}]])assert.equal((await h.mcp(name,args)).isError,true);
 assert.equal(h.relay.calls.length,0);assert.deepEqual(h.storage.map,before);
 assert.equal((await h.mcp('grok_status',{health:true,probe_identity:true})).structuredContent.downstream.ok,true);
 assert.deepEqual(h.storage.map,before);
});
