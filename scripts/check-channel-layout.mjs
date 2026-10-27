// Offline manifest lint. Never opens session files, resolves symlinks or contacts services.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export function checkLayout(rows) {
  if (!Array.isArray(rows) || rows.length < 1) throw Error('invalid_layout');
  const fields = ['channel','relay','home','session','sessionLink','worker','stateNamespace','port','recipients','bearerEnv','serviceHandle'];
  const seen = new Map();
  const unique = (field, value) => {
    const key = field + ':' + value;
    if (seen.has(key)) throw Error('collision_' + field);
    seen.set(key, true);
  };
  for (const row of rows) {
    if (!row || Object.keys(row).some(k => !fields.includes(k)) || fields.some(k => row[k] === undefined)) throw Error('invalid_fields');
    for (const k of ['channel','serviceHandle','worker']) if (typeof row[k] !== 'string' || !(k === 'worker' ? /^[a-z0-9][a-z0-9_-]{0,62}$/ : /^[a-z0-9][a-z0-9_-]{0,31}$/).test(row[k])) throw Error('invalid_' + k);
    const u = new URL(row.relay);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw Error('invalid_relay');
    if (!Array.isArray(row.recipients) || !row.recipients.length || row.recipients.some(n => typeof n !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(n) || n === row.serviceHandle)) throw Error('invalid_recipients');
    if (!/^[A-Z_][A-Z0-9_]*$/.test(row.bearerEnv)) throw Error('invalid_bearer_env');
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(row.session)) throw Error('invalid_session');
    if (typeof row.stateNamespace !== 'string' || !row.stateNamespace.trim()) throw Error('invalid_namespace');
    for (const k of ['home','sessionLink']) if (typeof row[k] !== 'string' || !path.isAbsolute(row[k]) || path.normalize(row[k]) !== row[k]) throw Error('invalid_' + k);
    if (path.basename(row.sessionLink) !== row.session + '.json') throw Error('session_link_mismatch');
    if (row.port !== null && (!Number.isInteger(row.port) || row.port < 1024 || row.port > 65535)) throw Error('invalid_port');
    unique('channel', u.origin + '/' + row.channel);
    for (const k of ['home','session','sessionLink','worker','stateNamespace','bearerEnv']) unique(k,row[k]);
    if (row.port !== null) unique('port',row.port);
  }
  return { ok:true, channels:rows.length, mode:'offline_manifest_only', session_files_read:false, runtime_verified:false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(checkLayout(JSON.parse(readFileSync(process.argv[2], 'utf8'))))); }
  catch { console.error(JSON.stringify({ok:false,error:'layout_check_failed',values_redacted:true})); process.exitCode=1; }
}
