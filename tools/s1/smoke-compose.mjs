// 专用合成实例：不触碰默认yoyo实例。不得用该脚本给真实实例灌入测试数据。
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const project='yoyo-s11-smoke',base='http://localhost:3100';
const env={...process.env,YOYO_PORT:'3100',APP_ORIGIN:base,S3_PORT:'59060',S3_PUBLIC_ENDPOINT:'http://localhost:59060'};
function compose(args){const r=spawnSync('docker',['compose','-p',project,...args],{env,encoding:'utf8'});if(r.status!==0)throw new Error('Compose command failed: '+args[0]);return r.stdout;}
function scalar(sql){return compose(['exec','-T','db','psql','-U','yoyo','-d','yoyo','-At','-c',sql]).trim();}
const checkpoints=[];let cookie='',csrf='';
async function call(path,method='GET',body){const r=await fetch(base+'/api/v1'+path,{method,headers:{Connection:'close',Cookie:cookie,'Content-Type':'application/json',...(method!=='GET'?{Origin:base,'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID()}:{})},...(method!=='GET'?{body:JSON.stringify(body??{})}:{})});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];const j=await r.json();assert.ok(r.ok,`HTTP ${r.status}: ${j.error?.code}`);if(j.data.csrf_token)csrf=j.data.csrf_token;return j.data;}
async function until(fn){for(let n=0;n<50;n++){const r=await fn();if(r)return r;await new Promise(r=>setTimeout(r,200));}throw new Error('Timed out waiting for runtime state');}
compose(['up','-d','--wait']);
const secretHash=()=>createHash('sha256').update(compose(['exec','-T','api','node','-e',"process.stdout.write(require('node:fs').readFileSync('/state/instance.json'))"])).digest('hex');
const beforeSecret=secretHash();const input={email:'compose@example.test',password:'Compose-test-password-987',display_name:'容器测试管理员',workspace_name:'合成容器工作区'};
if(!(await call('/setup/status')).initialized){
  const token=compose(['exec','-T','api','node','dist/tools/setup-token.js']).trim();await call('/auth/csrf');await call('/setup','POST',{...input,setup_token:token});
}
await call('/auth/csrf');await call('/auth/login','POST',{email:input.email,password:input.password});checkpoints.push('first_setup_and_login');
const current=await call('/accounts');let account=current.items[0];if(!account)account=await call('/accounts','POST',{platform:'xiaohongshu',platform_user_id:'compose-platform-id',name:'合成容器账号'});
const before=scalar('SELECT (SELECT count(*) FROM users)||\':\'||(SELECT count(*) FROM accounts)||\':\'||(SELECT count(*) FROM schema_migrations)');
for(const pool of ['general']){
  const accepted=await call('/diagnostics','POST',{pool});await until(async()=>{const j=await call('/jobs/'+accepted.job_id);return j.state==='succeeded';});checkpoints.push(pool+'_job_completed');
}
const notices=await call('/notifications');assert.ok(notices.items.length>=1);checkpoints.push('personal_notifications');
// 同一HTTP幂等键经历API重建仍复用结果。
const key=randomUUID();
async function patch(){const r=await fetch(base+'/api/v1/accounts/'+account.id,{method:'PATCH',headers:{Connection:'close',Cookie:cookie,'Content-Type':'application/json',Origin:base,'X-CSRF-Token':csrf,'Idempotency-Key':key},body:JSON.stringify({name:'重启持久化核验',expected_version:account.version})});const j=await r.json();assert.equal(r.status,200);return j.data;}
const patched=await patch();
compose(['stop']);compose(['up','-d','--wait']);assert.equal(secretHash(),beforeSecret);assert.equal(scalar('SELECT (SELECT count(*) FROM users)||\':\'||(SELECT count(*) FROM accounts)||\':\'||(SELECT count(*) FROM schema_migrations)'),before);
assert.equal((await patch()).version,patched.version);checkpoints.push('stop_start_data_credentials_session_idempotency_preserved');
compose(['up','-d','--force-recreate','--wait']);assert.equal(secretHash(),beforeSecret);assert.equal((await call('/accounts/'+account.id)).version,patched.version);checkpoints.push('container_recreation_and_repeated_migrations_preserved');
const monitor=await until(async()=>{const m=await call('/monitor');return m.processes.filter(p=>p.healthy).length>=3?m:null;});
checkpoints.push('scheduler_general_media_health');
const image=JSON.parse(spawnSync('docker',['image','inspect','yoyo-local:0.1.0'],{encoding:'utf8'}).stdout)[0];
mkdirSync('docs/evidence/s11',{recursive:true});writeFileSync('docs/evidence/s11/compose-smoke.json',JSON.stringify({checked_at:new Date().toISOString(),kind:'synthetic_isolated_compose_runtime',project,architecture:image.Architecture,image_id:image.Id,checkpoints,services:monitor.processes.map(p=>({pool:p.pool,healthy:p.healthy})),credentials_or_payloads_included:false},null,2)+'\n');
console.log('PASS: '+checkpoints.join(', '));
