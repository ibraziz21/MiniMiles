// Run from repository root with the source DSN and dashboard environment loaded.
// Preserves current live function bodies except the requested publication branch.
const fs=require('fs'),cp=require('child_process');
const u=new URL(process.env.VERIFICATION_SOURCE_DATABASE_URL),project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
if(!decodeURIComponent(u.username).endsWith('.'+project))throw new Error('Source project mismatch');
const env={...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:u.pathname.slice(1),PGCONNECT_TIMEOUT:'10',PGSSLMODE:'require'};
function sql(input){const r=cp.spawnSync('psql',['-X','-q','-At','-v','ON_ERROR_STOP=1'],{env,input,encoding:'utf8'});if(r.status)throw new Error((r.stderr||'SQL failed').replaceAll(env.PGPASSWORD,'[redacted]'));return r.stdout.trim();}
const signatures=['transition_voucher_funding_program_atomic(uuid,text,uuid,text,integer)','transition_voucher_funding_allocation_atomic(uuid,text,uuid,text)'];
const defs=signatures.map(s=>sql(`select pg_get_functiondef('${s}'::regprocedure);`));
const views=['v_web_push_marketing_audience','v_web_push_campaign_delivery_stats'].map(s=>`CREATE OR REPLACE VIEW ${s} AS ${sql(`select pg_get_viewdef('${s}'::regclass,true);`)}`);
const dir='packages/admin-dashboard/output/logic-deployment';fs.mkdirSync(dir,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
fs.writeFileSync(`${dir}/before-${stamp}.sql`,defs.join(';\n')+';' +'\n'+views.join('\n'));
const changed=defs.map(def=>{const pattern=/p_action\s*=\s*'publish'\s+AND\s+v_row.state\s*=\s*'approved'/gi;const matches=def.match(pattern);if(matches?.length===1)return def.replace(pattern,"p_action='publish' AND v_row.state IN('pending_approval','approved')");if(def.includes("IN('pending_approval','approved')"))return def;throw new Error('Unexpected publication function; review required');});
const migrations=['024_native_campaign_audience.sql','025_merchant_support_notes.sql','026_reimbursement_evidence.sql'].map(f=>fs.readFileSync('packages/admin-dashboard/sql/'+f,'utf8').replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,''));
const bundle="BEGIN;\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='30s';\n"+changed.join(';\n')+';' +'\n'+migrations.join('\n')+'\nCOMMIT;';
fs.writeFileSync(`${dir}/applied-${stamp}.sql`,bundle);
sql(bundle);
console.log('Applied publication, native campaign audience, merchant notes and private receipt storage atomically. Function/view backup saved under output/logic-deployment.');
