// Conservative gate for the documented single-environment TOML deployment path.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function checkRelayDeploy(source) {
  const text=source.replace(/#[^\n]*/g,'');
  if (/^\s*\[env[.\]]/m.test(text)) throw Error('environment_overrides_require_separate_review');
  const sections=text.split(/^\s*\[([^\]]+)\]\s*$/m);
  const values=[];
  for(let i=1;i<sections.length;i+=2) if(sections[i]==='vars') {
    for(const match of sections[i+1].matchAll(/^\s*LOOP_GUARD_MAX\s*=\s*(.*?)\s*$/gm)) values.push(match[1]);
  }
  if(values.length!==1 || !['"0"',"'0'",'0'].includes(values[0])) throw Error('explicit_loop_guard_zero_required');
  return {ok:true,loop_guard_max:0};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try{console.log(JSON.stringify(checkRelayDeploy(readFileSync(process.argv[2],'utf8'))));}
  catch{console.error('relay_deploy_preflight_failed: require explicit vars.LOOP_GUARD_MAX=0 and no environment overrides');process.exitCode=1;}
}
