import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkRelayDeploy} from '../check-relay-deploy.mjs';
test('relay deploy gate requires explicit zero; legacy off, absence, positive and override reject',()=>{
 assert.equal(checkRelayDeploy(readFileSync(new URL('../../relay/wrangler.toml',import.meta.url),'utf8')).ok,true);
 for(const s of ['[vars]\nLOOP_GUARD="off"','[vars]\nLOOP_GUARD_MAX="256"','[vars]\n# LOOP_GUARD_MAX="0"','[vars]\nLOOP_GUARD_MAX="0"\n[env.prod.vars]\nLOOP_GUARD_MAX="1"','[vars]\nLOOP_GUARD_MAX="0"\nLOOP_GUARD_MAX="2"']) assert.throws(()=>checkRelayDeploy(s));
});
