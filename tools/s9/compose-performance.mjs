/** Synthetic scale restored into a new, capped release Compose project; no source DB writes. */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {request} from 'node:https';
import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const attempt=process.argv[2]??'1';assert.match(attempt,/^\d+$/);
const version='0.1.0-s9rc10',project='yoyo-s9-capped-arm64-'+attempt,dir=resolve('.local/s9-capped-arm64-'+attempt),base='https://localhost:3445';
const bundle=resolve('.local/releases/'+version),files=['compose.yaml','compose.release.yaml','compose.https.yaml','compose.release-https.yaml'];
assert.equal(execFileSync('docker',['ps','-aq','--filter','label=com.docker.compose.project='+project],{encoding:'utf8'}).trim(),'');
assert.equal(execFileSync('docker',['volume','ls','-q','--filter','label=com.docker.compose.project='+project],{encoding:'utf8'}).trim(),'');
mkdirSync(dir,{recursive:false,mode:0o700});mkdirSync(dir+'/deploy');for(const f of files)copyFileSync(bundle+'/'+f,dir+'/'+f);copyFileSync(bundle+'/deploy/Caddyfile',dir+'/deploy/Caddyfile');
const caps={init:[.25,256],migrate:[.5,512],db:[1,1024],storage:[.5,512],api:[.5,512],worker:[.25,256],media:[.25,256],'media-executor':[.5,1024],scheduler:[.125,128],proxy:[.125,128]};
writeFileSync(dir+'/caps.yaml','services:\n'+Object.entries(caps).map(([service,[cpu,mib]])=>`  ${service}:\n    cpus: ${cpu}\n    mem_limit: ${mib}m\n`).join(''));
files.push('caps.yaml');
const env={...process.env,YOYO_VERSION:version,YOYO_ARCH:'arm64',HTTPS_ORIGIN:base,HTTPS_PORT:'3445',SOURCE_BRIDGE_URL:'',SOURCE_BRIDGE_TOKEN:''};
const compose=a=>execFileSync('docker',['compose','--project-directory',dir,'-p',project,...files.flatMap(f=>['-f',dir+'/'+f]),...a],{env,encoding:'utf8',maxBuffer:10000000});
const sql=q=>compose(['exec','-T','db','psql','-U','yoyo','-d','yoyo','-Atc',q]).trim();
const counts=q=>JSON.parse(q("SELECT json_build_object('sources',(SELECT count(*) FROM source_items),'publications',(SELECT count(*) FROM publications),'observations',(SELECT count(*) FROM metric_observations))::text"));
const from=q=>execFileSync('docker',['exec','yoyo-dev-db-1','psql','-U','yoyo','-d','yoyo_s9_performance_test','-Atc',q],{encoding:'utf8'}).trim();
const expected={sources:10000,publications:1000,observations:100000};assert.deepEqual(counts(from),expected);
let ca;
const raw=(path,method='GET',body,headers={})=>new Promise((resolve,reject)=>{const q=request(base+'/api/v1'+path,{method,ca,agent:false,headers},r=>{const b=[];r.on('data',c=>b.push(c));r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,body:Buffer.concat(b)}));});q.on('error',reject);q.setTimeout(10000,()=>q.destroy(new Error('HTTPS_TIMEOUT')));if(body)q.write(JSON.stringify(body));q.end();});
function client(){let cookie='',csrf='';return async(path,method='GET',body)=>{const r=await raw(path,method,body,{'Content-Type':'application/json',Cookie:cookie,...(method!=='GET'?{Origin:base,'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID()}:{})});const j=JSON.parse(r.body);assert.ok(r.status<300,`HTTP ${r.status} ${j.error?.code}`);if(r.headers['set-cookie'])cookie=r.headers['set-cookie'][0].split(';')[0];if(j.data?.csrf_token)csrf=j.data.csrf_token;return j.data;};}
const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
const report={checked_at:new Date().toISOString(),version,project,classification:'synthetic_scale_actual_capped_release_compose',architecture:'native_arm64_docker_desktop',dedicated_minimum_host_verified:false,clean_remote_clone_verified:false,production_environment_acceptance:false,caps,api:[],ui:[]};
try{
 const began=performance.now();compose(['up','-d','--pull','never','--wait','db','storage']);report.empty_database_services_start_ms=performance.now()-began;
 const dump=execFileSync('docker',['exec','yoyo-dev-db-1','pg_dump','-U','yoyo','-Fc','yoyo_s9_performance_test'],{maxBuffer:100000000});writeFileSync(dir+'/synthetic-scale.dump',dump,{mode:0o600});
 execFileSync('docker',['compose','--project-directory',dir,'-p',project,...files.flatMap(f=>['-f',dir+'/'+f]),'exec','-T','db','pg_restore','-U','yoyo','--no-owner','-d','yoyo'],{env,input:dump,maxBuffer:10000000});assert.deepEqual(counts(sql),expected);report.synthetic_backup_sha256=createHash('sha256').update(dump).digest('hex');
 report.restored_statistics_before=sql("SELECT json_agg(row_to_json(s))::text FROM (SELECT relname,n_live_tup,last_analyze,last_autoanalyze FROM pg_stat_user_tables WHERE relname IN ('publications','metric_observations')) s");
 const accountForPlan=sql('SELECT id FROM accounts LIMIT 1'),workspaceForPlan=sql('SELECT workspace_id FROM accounts LIMIT 1');
 const query=`EXPLAIN SELECT p.id FROM publications p WHERE p.workspace_id='${workspaceForPlan}' AND p.account_id=ANY(ARRAY['${accountForPlan}']::uuid[]) AND p.lifecycle='active' AND NOT EXISTS(SELECT 1 FROM metric_observations o WHERE o.publication_id=p.id AND o.validity='confirmed' AND o.metric->>'value' IS NOT NULL) ORDER BY p.published_at,p.id LIMIT 3`;
 report.plan_before_analyze=sql(query).replace(/[a-f0-9-]{36}/g,'{id}');sql('ANALYZE');report.plan_after_analyze=sql(query).replace(/[a-f0-9-]{36}/g,'{id}');
 const runtimeStart=performance.now();compose(['up','-d','--pull','never','--wait']);report.restored_services_start_ms=performance.now()-runtimeStart;ca=compose(['exec','-T','proxy','cat','/data/caddy/pki/authorities/local/root.crt']);
 const ids=compose(['ps','-aq']).trim().split('\n');const runtime=JSON.parse(execFileSync('docker',['inspect',...ids],{encoding:'utf8'}));for(const c of runtime){const service=c.Config.Labels['com.docker.compose.service'];assert.equal(c.HostConfig.NanoCpus,caps[service][0]*1e9);assert.equal(c.HostConfig.Memory,caps[service][1]*1024**2);assert.equal(c.State.OOMKilled,false);}
 report.limits_verified=true;report.migrations=Number(sql('SELECT count(*) FROM schema_migrations'));assert.equal(report.migrations,37);
 const users=[];for(const email of ['admin@example.test',...Array.from({length:4},(_,i)=>`performance-${i+1}@example.test`)]){const c=client();await c('/auth/csrf');await c('/auth/login','POST',{email,password:'A-safe-test-password-987'});users.push(c);}
 const account=JSON.parse(sql('SELECT row_to_json(a)::text FROM accounts a LIMIT 1')),item=sql('SELECT id FROM source_items LIMIT 1'),pub=sql('SELECT id FROM publications LIMIT 1'),obs=sql('SELECT id FROM metric_observations LIMIT 1');
 const routes=['/dashboard?account_id='+account.id,'/source-items?limit=20','/source-items/'+item,'/publications?account_id='+account.id+'&limit=20','/publications/'+pub,'/metrics?account_id='+account.id+'&limit=20','/metrics/'+obs+'/sources'];
 for(const path of routes){for(const u of users)await u(path);const values=[];for(let batch=0;batch<10;batch++)await Promise.all(users.map(async u=>{const start=performance.now();await u(path);values.push(performance.now()-start);}));report.api.push({route:path.replace(/[a-f0-9-]{36}/g,'{id}'),requests:values.length,concurrency:5,p95_ms:p95(values),max_ms:Math.max(...values),target_ms:1000});}
 const accepted=[];for(let i=0;i<20;i++){const start=performance.now();await users[0]('/diagnostics','POST',{pool:'general'});accepted.push(performance.now()-start);}report.async_acceptance={requests:20,p95_ms:p95(accepted),target_ms:2000};
 const browser=await chromium.launch();try{
  const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});await page.goto(base);await page.getByLabel('邮箱').fill('admin@example.test');await page.getByLabel('密码',{exact:false}).fill('A-safe-test-password-987');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('heading',{name:'测试管理员，欢迎回来'}).waitFor();
  for(const width of [1440,1280,390]){await page.setViewportSize({width,height:1000});for(const [name,heading] of [['工作台','接下来的工作'],['选题策划','选题策划'],['数据复盘','数据复盘']]){const values=[];for(let i=0;i<10;i++){const start=performance.now();await page.getByRole('link',{name,exact:true}).click();await page.getByRole('heading',{name:heading,exact:true}).first().waitFor();await expect(page.getByRole('status').filter({hasText:'正在加载'})).toHaveCount(0);if(name==='工作台')await expect(page.getByRole('button',{name:'刷新工作台'})).toBeEnabled();else if(name==='选题策划')await expect(page.getByRole('button',{name:'添加来源',exact:true})).toBeEnabled();else await expect(page.getByLabel('上传后台截图')).toBeEnabled();values.push(performance.now()-start);await page.getByRole('link',{name:name==='工作台'?'选题策划':'工作台',exact:true}).click();}report.ui.push({page:name,viewport:width,samples:values.length,p95_ms:p95(values),target_ms:3000});}}
 }finally{await browser.close();}
 report.source_dataset_after=counts(from);assert.deepEqual(report.source_dataset_after,expected);report.dataset={...expected,users:5};
 report.stats=compose(['ps','--services','--status','running']).trim().split('\n');report.result=report.api.every(r=>r.p95_ms<=r.target_ms)&&report.ui.every(r=>r.p95_ms<=r.target_ms)&&report.async_acceptance.p95_ms<=2000?'passed_capped_compose_scope':'needs_optimization';
 assert.equal(report.result,'passed_capped_compose_scope');
}catch(e){report.result='failed';report.failure_code=e.code??'CHECK_FAILED';console.error('CAPPED_COMPOSE_FAILED',String(e.message).replace(/https?:\/\/[^\s]+/g,'[url-redacted]'));process.exitCode=1;}
finally{try{compose(['stop']);}catch{process.exitCode=1;}writeFileSync('docs/evidence/s9/performance-compose.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,api:report.api.map(r=>({route:r.route,p95_ms:r.p95_ms})),ui:report.ui}));}
