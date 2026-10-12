/** Real backup/restore on isolated Compose instances; all business values explicitly synthetic. */
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {request} from 'node:https';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const version='0.1.0-s9rc9',source=resolve('.local/s9-runtime-arm64-5'),target=resolve('.local/s9-recovery-arm64-1'),project='yoyo-s9-recovery-arm64-1';
const files=['compose.yaml','compose.release.yaml','compose.https.yaml','compose.release-https.yaml'];mkdirSync(target,{recursive:false,mode:0o700});mkdirSync(target+'/deploy');copyFileSync('deploy/Caddyfile',target+'/deploy/Caddyfile');for(const f of files)copyFileSync(source+'/'+f,target+'/'+f);
const env={...process.env,YOYO_VERSION:version,YOYO_ARCH:'arm64',HTTPS_ORIGIN:'https://localhost:3443',HTTPS_PORT:'3443',SOURCE_BRIDGE_URL:'',SOURCE_BRIDGE_TOKEN:''};
const command=(dir,p,args)=>execFileSync('docker',['compose','--project-directory',dir,'-p',p,...files.flatMap(f=>['-f',dir+'/'+f]),...args],{env,encoding:'utf8',maxBuffer:10000000});
const from=args=>command(source,'yoyo-s9-arm64-5',args),to=args=>command(target,project,args);
const sql=(run,query)=>run(['exec','-T','db','psql','-U','yoyo','-d','yoyo','-Atc',query]).trim();
const hash=b=>createHash('sha256').update(b).digest('hex');
const snapshot=run=>({business:sql(run,"SELECT json_build_object('publications',(SELECT json_agg(row_to_json(p) ORDER BY id) FROM publications p),'observations',(SELECT json_agg(row_to_json(o) ORDER BY id) FROM metric_observations o),'evidence',(SELECT json_agg(row_to_json(e) ORDER BY id) FROM metric_evidence e),'supersessions',(SELECT json_agg(row_to_json(s) ORDER BY old_id,new_id) FROM observation_supersessions s),'files',(SELECT json_agg(row_to_json(f) ORDER BY id) FROM file_objects f),'jobs',(SELECT json_agg(json_build_object('id',id,'type',type,'state',state,'input',input,'result',result) ORDER BY id) FROM jobs WHERE type='diagnostic.run'))::text"),credentials:hash(run(['exec','-T','api','node','-e',"process.stdout.write(require('node:fs').readFileSync('/state/instance.json'))"])),migrations:sql(run,'SELECT count(*) FROM schema_migrations')});
let ca=readFileSync(source+'/root.crt'),cookie='',csrf='';
function raw(url,method='GET',body,headers={}){return new Promise((resolve,reject)=>{const q=request(url,{method,ca,agent:false,headers},r=>{const chunks=[];r.on('data',b=>chunks.push(b));r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,body:Buffer.concat(chunks)}));});q.on('error',reject);q.setTimeout(10000,()=>q.destroy(new Error('HTTPS_TIMEOUT')));if(body)q.write(body);q.end();});}
async function call(path,method='GET',body){const r=await raw('https://localhost:3443/api/v1'+path,method,body?Buffer.from(JSON.stringify(body)):undefined,{Cookie:cookie,'Content-Type':'application/json',...(method!=='GET'?{Origin:env.HTTPS_ORIGIN,'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID()}:{})});const j=JSON.parse(r.body);assert.ok(r.status<300,j.error?.code);if(r.headers['set-cookie'])cookie=r.headers['set-cookie'][0].split(';')[0];if(j.data.csrf_token)csrf=j.data.csrf_token;return j.data;}
async function login(){await call('/auth/csrf');await call('/auth/login','POST',{email:'s9-admin@example.test',password:'Synthetic-S9-password-987'});}
const started=Date.now(),checks=[];
try{
 from(['up','-d','--pull','never','--wait']);await login();const account=(await call('/accounts')).items[0];
 const publication=await call('/publications','POST',{account_id:account.id,platform_note_id:'synthetic-recovery-note',url:'https://www.xiaohongshu.com/explore/synthetic-recovery-note',title:'明确合成恢复笔记',media_type:'graphic',published_at:'2026-01-01T00:00:00Z',traffic_type:'unknown'});
 const metric=value=>({target:{account_id:account.id,publication_id:publication.id},metric_key:'reads',definition_version:'1',aggregation_kind:'cumulative',value,unit:'次',observed_at:'2026-10-01T00:00:00Z',time_precision:'day',traffic_type:'unknown',is_approximate:false,source_definition:'明确合成恢复口径',source_note:'Synthetic recovery test, not real backend'});
 async function batch(value){const b=await call('/imports','POST',{account_id:account.id,file_ids:[],source_type:'manual',manual_rows:[metric(value)]});const r=(await call('/imports/'+b.id+'/rows')).items[0];return {b,r};}
 const first=await batch('100');await call('/imports/'+first.b.id+'/confirm','POST',{row_ids:[first.r.id],conflict_resolutions:[],reason:'合成恢复首次确认',expected_version:first.b.version});
 const next=await batch('101'),conflict=(await call('/imports/'+next.b.id+'/rows')).items[0];await call('/imports/'+next.b.id+'/confirm','POST',{row_ids:[next.r.id],conflict_resolutions:[{row_id:next.r.id,resolution:'replace',existing_observation_id:conflict.existing_observation_id}],reason:'合成更正链，恢复应保留两值',expected_version:next.b.version});
 checks.push('independent_publication_metric_correction_history_seeded');
 const file=JSON.parse(sql(from,"SELECT row_to_json(f)::text FROM file_objects f WHERE NOT is_preview ORDER BY created_at LIMIT 1"));const signed=await call('/files/'+file.id+'/download'),bytes=await raw(signed.url);assert.equal(hash(bytes.body),file.sha256);
 const before=snapshot(from),backup=source+'/recovery-backup';execFileSync('sh',[resolve('tools/s9/backup.sh'),'yoyo-s9-arm64-5',backup,...files.map(f=>source+'/'+f)],{env,stdio:'inherit'});from(['stop']);
 const recoveryStart=Date.now();execFileSync('sh',[resolve('tools/s9/restore.sh'),project,backup,...files.map(f=>target+'/'+f)],{env,stdio:'inherit'});const after=snapshot(to);assert.deepEqual(after,before);checks.push('database_identity_correction_evidence_files_credentials_same_recovery_point');
 assert.equal(hash(to(['exec','-T','proxy','cat','/data/caddy/pki/authorities/local/root.crt'])),hash(ca));checks.push('tls_authority_preserved');
 await call('/me');checks.push('session_survives_matching_state_and_database_restore');const restored=await call('/files/'+file.id+'/download');assert.equal(hash((await raw(restored.url)).body),file.sha256);checks.push('private_evidence_original_download_hash_preserved');
 const unchanged=to(['ps','--services','--status','running']).trim();assert.notEqual(spawnSync('sh',[resolve('tools/s9/restore.sh'),project,backup,...files.map(f=>target+'/'+f)],{env,encoding:'utf8'}).status,0);assert.equal(to(['ps','--services','--status','running']).trim(),unchanged);checks.push('existing_restore_target_refused_without_service_change');
 const elapsed=Date.now()-recoveryStart;assert.ok(elapsed<4*3600000);
 const report={checked_at:new Date().toISOString(),version,classification:'synthetic_business_actual_compose_restore',source_project:'yoyo-s9-arm64-5',target_project:project,checks,logical_snapshot_sha256:hash(before.business),credential_sha256:before.credentials,migrations:before.migrations,restore_elapsed_ms:elapsed,total_elapsed_ms:Date.now()-started,rto_test_target_ms:4*3600000,rpo:'same_point_no_write_between_backup_and_restore_not_operational_daily_backup_sla',original_use_instances_changed:false,result:'passed_partial_recovery_scope'};
 writeFileSync('docs/evidence/s9/recovery-local.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,checks:checks.length,restore_elapsed_ms:elapsed}));
}catch(e){console.error('RECOVERY_CHECK_FAILED',e.code??e.message);process.exitCode=1;}
finally{for(const run of [from,to])try{run(['stop']);}catch{process.exitCode=1;}}
