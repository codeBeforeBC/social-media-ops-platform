/** Real HTTPS/Compose checks with synthetic data, only in new named S9 instances. */
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {request} from 'node:https';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [version,arch]=process.argv.slice(2);assert.match(version??'',/^\d+\.\d+\.\d+-[a-z0-9.-]+$/);assert.ok(['arm64','amd64'].includes(arch));
const attempt=process.argv[4]??'1';assert.match(attempt,/^\d+$/);
const project='yoyo-s9-'+arch+'-'+attempt,dir=resolve('.local/s9-runtime-'+arch+'-'+attempt),base='https://localhost:'+(arch==='arm64'?3443:3444);
const files=['compose.yaml','compose.release.yaml','compose.https.yaml','compose.release-https.yaml'];
mkdirSync(dir,{recursive:false,mode:0o700});mkdirSync(dir+'/deploy');copyFileSync('deploy/Caddyfile',dir+'/deploy/Caddyfile');for(const file of files)copyFileSync(file,dir+'/'+file);
const env={...process.env,YOYO_VERSION:version,YOYO_ARCH:arch,HTTPS_ORIGIN:base,HTTPS_PORT:new URL(base).port,SOURCE_BRIDGE_URL:'',SOURCE_BRIDGE_TOKEN:''};
const args=['compose','--project-directory',dir,'-p',project,...files.flatMap(file=>['-f',dir+'/'+file])];
const compose=(a)=>execFileSync('docker',[...args,...a],{env,encoding:'utf8',maxBuffer:10000000});
const hash=b=>createHash('sha256').update(b).digest('hex');
const scalar=sql=>compose(['exec','-T','db','psql','-U','yoyo','-d','yoyo','-Atc',sql]).trim();
const counts=()=>scalar("SELECT (SELECT count(*) FROM users)||':'||(SELECT count(*) FROM accounts)||':'||(SELECT count(*) FROM file_objects)||':'||(SELECT count(*) FROM schema_migrations)");
let ca,cookie='',csrf='';const checks=[];
async function until(fn){for(let i=0;i<90;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,1000));}throw new Error('S9 runtime timed out');}
function raw(url,method='GET',body,headers={}){return new Promise((resolve,reject)=>{
 const req=request(url,{method,ca,agent:false,headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);req.setTimeout(10000,()=>req.destroy(new Error('HTTPS timeout')));if(body)req.write(body);req.end();
});}
async function call(path,method='GET',body,key=randomUUID()){
 const r=await raw(base+'/api/v1'+path,method,body===undefined?undefined:Buffer.from(JSON.stringify(body)),{'Content-Type':'application/json',Cookie:cookie,'X-Forwarded-For':'203.0.113.123',...(method!=='GET'?{Origin:base,'X-CSRF-Token':csrf,'Idempotency-Key':key}:{})});
 const j=JSON.parse(r.body);assert.ok(r.status<300,`HTTP ${r.status} ${j.error?.code}`);
 if(r.headers['set-cookie']){const value=r.headers['set-cookie'][0];assert.match(value,/HttpOnly/i);assert.match(value,/Secure/i);assert.match(value,/SameSite=Lax/i);cookie=value.split(';')[0];}
 if(j.data.csrf_token)csrf=j.data.csrf_token;return j.data;
}
try{
 compose(['up','-d','--pull','never','--wait']);
 ca=await until(()=>{try{return compose(['exec','-T','proxy','cat','/data/caddy/pki/authorities/local/root.crt']);}catch{return null;}});
 writeFileSync(dir+'/root.crt',ca,{mode:0o600});
 await call('/auth/csrf');const token=compose(['exec','-T','api','node','dist/tools/setup-token.js']).trim();
 await call('/setup','POST',{setup_token:token,email:'s9-admin@example.test',password:'Synthetic-S9-password-987',display_name:'合成S9管理员',workspace_name:'隔离S9交付验证'});
 await call('/auth/login','POST',{email:'s9-admin@example.test',password:'Synthetic-S9-password-987'});
 assert.equal(scalar("SELECT count(*) FROM login_limits WHERE key='login-ip:"+hash('203.0.113.123')+"'"),'0');checks.push('proxy_replaces_untrusted_forwarded_ip');
 const expectedMigrations=readdirSync('packages/db/migrations').filter(f=>f.endsWith('.sql')).length;assert.equal(scalar('SELECT count(*) FROM schema_migrations'),String(expectedMigrations));checks.push('https_trusted_ca_secure_session_first_setup_'+expectedMigrations+'_migrations');
 const me=await call('/me');let account=await call('/accounts','POST',{platform:'xiaohongshu',platform_user_id:'s9-synthetic',name:'合成S9账号'});
 const badOrigin=await raw(base+'/api/v1/accounts','POST',Buffer.from('{}'),{Cookie:cookie,'Content-Type':'application/json',Origin:'https://untrusted.invalid','X-CSRF-Token':csrf});assert.equal(badOrigin.status,403);checks.push('https_origin_guard');
 const invite=await call('/members','POST',{email:'s9-operator@example.test',display_name:'合成S9运营',roles:['operator']});
 await call('/auth/accept-invite','POST',{invitation_token:invite.invitation_token,password:'Synthetic-S9-operator-987'});
 account=await call('/accounts/'+account.id,'PATCH',{owner_id:invite.id,expected_version:account.version});
 await call('/members/'+invite.id,'PATCH',{roles:['viewer'],successor_id:me.membership.id,expected_version:invite.version});
 account=await call('/accounts/'+account.id);assert.equal(account.owner_id,me.membership.id);checks.push('member_invitation_and_owner_handoff');
 const image=readFileSync('tests/fixtures/transparent.png'),checksum=hash(image);
 const upload=await call('/uploads','POST',{account_id:account.id,name:'明确合成截图.png',size_bytes:image.length,mime_hint:'image/png',purpose:'import_screenshot',sha256:checksum});
 const target=await call('/uploads/'+upload.id+'/parts','POST',{part_number:1,checksum});
 const part=await raw(base+target.upload_url,'PUT',image,{'Content-Type':'application/octet-stream',Cookie:cookie,Origin:base,'X-CSRF-Token':csrf});assert.equal(part.status,200);
 const file=await call('/uploads/'+upload.id+'/complete','POST',{parts_manifest:[JSON.parse(part.body).data]});
 await until(async()=>{const failed=scalar("SELECT error_code FROM jobs WHERE type='file.validate' AND input->>'file_id'='"+file.id+"' AND state='failed'");assert.equal(failed,'','File validation failed: '+failed);try{return await call('/files/'+file.id+'/download');}catch{return null;}});
 const signed=await call('/files/'+file.id+'/download');assert.equal(new URL(signed.url).origin,base);const original=await raw(signed.url);assert.equal(original.status,200);assert.equal(hash(original.body),checksum);
 const unsigned=new URL(signed.url);unsigned.search='';assert.equal((await raw(unsigned)).status,403);const tampered=new URL(signed.url);tampered.searchParams.set('X-Amz-Signature','0'.repeat(64));assert.equal((await raw(tampered)).status,403);checks.push('isolated_parser_private_https_download_original_hash_signature_guard');
 const accepted=await call('/diagnostics','POST',{pool:'general'});await until(async()=>((await call('/jobs/'+accepted.job_id)).state==='succeeded'));checks.push('worker_scheduler_outbox_notification');
 const secretHash=()=>hash(compose(['exec','-T','api','node','-e',"process.stdout.write(require('node:fs').readFileSync('/state/instance.json'))"]));
 const before=counts(),credentials=secretHash(),key=randomUUID();const input={name:'S9持久化验证',expected_version:account.version};const patched=await call('/accounts/'+account.id,'PATCH',input,key);
 compose(['stop']);compose(['up','-d','--pull','never','--wait']);assert.equal(secretHash(),credentials);assert.equal(counts(),before);assert.equal((await call('/accounts/'+account.id,'PATCH',input,key)).version,patched.version);
 compose(['up','-d','--pull','never','--force-recreate','--wait']);assert.equal(secretHash(),credentials);assert.equal(counts(),before);assert.equal((await call('/accounts/'+account.id,'PATCH',input,key)).version,patched.version);checks.push('stop_start_recreate_credentials_data_session_idempotency');
 const backup=dir+'/backup';execFileSync('sh',[resolve('tools/s9/backup.sh'),project,backup,...files.map(f=>dir+'/'+f)],{env,stdio:'inherit'});
 assert.equal(secretHash(),credentials);assert.equal(counts(),before);const monitor=await until(async()=>{const m=await call('/monitor');return m.processes.filter(p=>p.healthy).length>=3?m:null;});assert.ok(monitor.processes.some(p=>p.pool==='scheduler'));checks.push('consistent_backup_and_running_services_restored');
 const running=compose(['ps','--services','--status','running']).trim();assert.notEqual(spawnSync('sh',[resolve('tools/s9/backup.sh'),project,backup,...files.map(f=>dir+'/'+f)],{env,encoding:'utf8'}).status,0);assert.equal(compose(['ps','--services','--status','running']).trim(),running);checks.push('existing_backup_refused_without_service_change');
 const parsed=compose(['logs','--no-color','proxy']);assert.ok(!parsed.includes('X-Amz-Signature'));assert.ok(!parsed.includes(cookie));checks.push('proxy_logs_no_cookie_or_signed_url');
 const report={checked_at:new Date().toISOString(),version,platform:'linux/'+arch,execution:arch==='arm64'?'native_arm64':'emulated_amd64_on_arm64',project,input_classification:'synthetic_only_not_real_backend',checks,migrations:expectedMigrations,backup_hashes:readFileSync(backup+'/SHA256SUMS','utf8').trim().split('\n'),original_instances_changed:false,published:false,result:'passed'};
 writeFileSync('docs/evidence/s9/runtime-'+arch+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:'passed',platform:report.platform,checks:checks.length}));
}catch(e){console.error('S9_RUNTIME_FAILED',e.message);process.exitCode=1;}
finally{try{compose(['stop']);}catch{process.exitCode=1;}}
