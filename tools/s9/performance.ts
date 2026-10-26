/** Actual measurements on a declared synthetic dataset, never production account metrics. */
import {writeFileSync} from 'node:fs';
import {cpus,totalmem,platform,arch} from 'node:os';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {server,Client,initialize} from '../../tests/helpers';
import {config} from '../../packages/domain/src/config';
async function main(){
 const env=await server(),admin=new Client(env.url),users:Client[]=[admin];
 const report:any={checked_at:new Date().toISOString(),classification:'synthetic_scale_actual_runtime_measurements',environment:{api:'native_host_node',db:'Docker Desktop arm64 PostgreSQL on loopback',host_platform:platform(),host_arch:arch(),host_cpus:cpus().length,host_memory_bytes:totalmem(),database:'yoyo_s9_performance_test'},production_environment_acceptance:false,api:[],ui:[]};
 try{
  const me=await initialize(admin),account=(await admin.call('/accounts','POST',{platform:'xiaohongshu',platform_user_id:'synthetic-scale-only',name:'明确合成性能账号'})).data;
  for(let i=1;i<=4;i++){const u=new Client(env.url);await u.init();users.push(u);}
  const source=(await admin.call('/source-connections','POST',{name:'合成规模来源（禁用）',platform:'xiaohongshu',provider:'opencli',source_type:'xhs_topic_signal',enabled:false,config:{keywords:['synthetic']}})).data;
  await env.db.query(`INSERT INTO source_items(workspace_id,connection_id,external_id,canonical_url,actual_source_type,title,captured_at,media_type,cluster_key,content_hash)
   SELECT $1,$2,'synthetic-'||i,'https://www.xiaohongshu.com/explore/synthetic-'||i,'search','合成线索 '||i,now()-i*interval '1 second','unknown','synthetic-'||i,md5(i::text) FROM generate_series(1,10000) i`,[me.workspace.id,source.id]);
  await env.db.query(`INSERT INTO publications(workspace_id,account_id,platform_note_id,url,published_at,recorded_by,traffic_type,title,media_type)
   SELECT $1,$2,'synthetic-'||i,'https://www.xiaohongshu.com/explore/synthetic-'||i,'2026-01-01'::timestamptz,$3,'unknown','合成已发布笔记 '||i,CASE WHEN i%2=0 THEN 'video' ELSE 'graphic' END FROM generate_series(1,1000) i`,[me.workspace.id,account.id,me.membership.id]);
  await env.db.query(`INSERT INTO metric_observations(workspace_id,account_id,publication_id,logical_key,revision,metric,value,validity,created_by,created_at)
   SELECT $1,$2,p.id,md5(p.id::text||':'||n),1,jsonb_build_object('target',jsonb_build_object('account_id',($2::uuid)::text,'publication_id',p.id),'metric_key',CASE WHEN p.media_type='video' THEN 'plays' ELSE 'reads' END,'definition_version','1','aggregation_kind','cumulative','value',n::text,'unit','次','observed_at',to_char('2026-02-01'::timestamptz+n*interval '1 day','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'time_precision','second','traffic_type','unknown','source_definition','明确合成性能口径','source_note','Synthetic load, not real backend','is_approximate',false),n,'confirmed',$3,now()-n*interval '1 second'
   FROM publications p CROSS JOIN generate_series(1,100) n WHERE p.account_id=$2::uuid`,[me.workspace.id,account.id,me.membership.id]);
  await env.db.query('ANALYZE');
  const count=(await env.db.query('SELECT (SELECT count(*)::int FROM source_items) sources,(SELECT count(*)::int FROM publications) publications,(SELECT count(*)::int FROM metric_observations) observations')).rows[0];assert.deepEqual(count,{sources:10000,publications:1000,observations:100000});report.dataset={...count,users:5,workspaces:1,accounts:1};
  const item=(await env.db.query('SELECT id FROM source_items LIMIT 1')).rows[0],pub=(await env.db.query('SELECT id FROM publications LIMIT 1')).rows[0],obs=(await env.db.query('SELECT id FROM metric_observations LIMIT 1')).rows[0];
  const routes=['/dashboard?account_id='+account.id,'/source-items?limit=20','/source-items/'+item.id,'/publications?account_id='+account.id+'&limit=20','/publications/'+pub.id,'/metrics?account_id='+account.id+'&limit=20','/metrics/'+obs.id+'/sources'];
  const percentile=(values:number[])=>values.sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]!;
  for(const route of routes){for(const user of users)assert.equal((await user.call(route)).status,200);const values:number[]=[];
   for(let batch=0;batch<10;batch++)await Promise.all(users.map(async user=>{const start=performance.now(),r=await user.call(route);assert.equal(r.status,200);values.push(performance.now()-start);}));
   report.api.push({route:route.replace(/[a-f0-9-]{36}/g,'{id}'),requests:values.length,concurrency:5,p95_ms:percentile(values),max_ms:Math.max(...values),target_ms:1000});
  }
  const accepted:number[]=[];for(let i=0;i<20;i++){const start=performance.now();assert.equal((await admin.call('/diagnostics','POST',{pool:'general'})).status,202);accepted.push(performance.now()-start);}report.async_acceptance={requests:20,p95_ms:percentile(accepted),target_ms:2000,execution_not_measured:true};
  writeFileSync('docs/evidence/s9/performance-api-observed.json',JSON.stringify(report,null,2)+'\n');
  config.origin=env.url;
  const browser=await chromium.launch();try{const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(env.url);await page.getByRole('heading',{name:'测试管理员，欢迎回来'}).waitFor();
   for(const [name,heading] of [['工作台','接下来的工作'],['选题策划','选题策划'],['数据复盘','数据复盘']] as const){const start=performance.now();await page.getByRole('link',{name,exact:true}).click();await page.getByRole('heading',{name:heading,exact:true}).first().waitFor();await expect(page.getByRole('status').filter({hasText:'正在加载'})).toHaveCount(0);await expect(page.getByRole('link',{name,exact:true})).toBeEnabled();if(name==='工作台')await page.getByRole('button',{name:'刷新工作台'}).click();else if(name==='选题策划')await expect(page.getByRole('button',{name:'添加来源',exact:true})).toBeEnabled();else {await expect(page.getByLabel('上传后台截图')).toBeEnabled();await page.getByLabel('分析开始（带时区 ISO8601）').fill('2026-02-01T00:00:00Z');await page.getByLabel('分析结束（带时区 ISO8601）').fill('2026-02-08T00:00:00Z');await page.getByRole('button',{name:'应用分析窗口'}).click();await expect(page.getByRole('heading',{name:'已确认数据概览'})).toBeVisible();await expect(page.getByRole('status').filter({hasText:'正在加载'})).toHaveCount(0);}report.ui.push({page:name,viewport:1440,elapsed_ms:performance.now()-start,target_ms:3000,condition:'loaded navigation and meaningful enabled control; recap analysis explicitly narrowed to 7 days; one sample, not p95'});}
  }finally{await browser.close();}
  report.result=report.api.every((r:any)=>r.p95_ms<=r.target_ms)&&report.async_acceptance.p95_ms<=2000?'passed_api_local_scope':'needs_optimization';
  writeFileSync('docs/evidence/s9/performance-local.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,dataset:report.dataset,api:report.api.map((r:any)=>({route:r.route,p95_ms:r.p95_ms}))}));
 }finally{await env.close();}
}
main().catch(e=>{console.error('PERFORMANCE_CHECK_FAILED',e.code??'CHECK_FAILED',e.message);process.exitCode=1;});
