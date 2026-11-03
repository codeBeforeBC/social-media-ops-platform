import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Client,initialize,server} from './helpers';
import {Jobs} from '../packages/domain/src/jobs';
import {canonical,sha} from '../packages/domain/src/protocol';
import {AITasks} from '../packages/domain/src/ai-tasks';
import {AIConfig,AIGateway,AIFailure} from '../packages/domain/src/ai-gateway';
let env:Awaited<ReturnType<typeof server>>,client:Client,me:any,account:any,dir:string,old:string|undefined;
const config:AIConfig={provider:'deepseek',base_url:'https://api.deepseek.com',model:'controlled',api_key:'controlled-not-real-key',enabled:true,allowed_data_types:'any_user_authorized',budget:{mode:'unlimited_user_authorized',per_task:null,daily:null},authorization_date:'2026-10-08',timeout_seconds:2,max_output_tokens:1000};
before(async()=>{dir=mkdtempSync(tmpdir()+'/yoyo-ai-');writeFileSync(dir+'/config.json',JSON.stringify(config),{mode:0o600});old=process.env.AI_CONFIG_FILE;process.env.AI_CONFIG_FILE=dir+'/config.json';env=await server();client=new Client(env.url);me=await initialize(client);account=(await client.seedAccount({platform:'xiaohongshu',platform_user_id:'d248f369493298217eb0bca4',name:'测试账号'})).data;});
after(async()=>{await env.close();if(old===undefined)delete process.env.AI_CONFIG_FILE;else process.env.AI_CONFIG_FILE=old;rmSync(dir,{recursive:true});});
const body=()=>({account_id:account.id,window:{start:new Date(Date.now()-86400000).toISOString(),end:new Date().toISOString()},columns:['日常观察']});
async function queue(){const r=await client.call('/topic-generations','POST',body());assert.equal(r.status,202);return r.data.request_id;}
function jobs(change?:()=>Promise<void>,failure=false){return new Jobs(env.db,{'ai.generate':new AITasks(env.db,()=>new AIGateway(env.db,config,async messages=>{if(failure)throw new AIFailure('AI_UNAVAILABLE');const input=JSON.parse(messages[1]!.content);await change?.();return {content:JSON.stringify({schema_version:input.schema_version,input_version:input.input_version,summary:'受控原创建议',evidence_refs:[],assumptions:['合成测试'],missing_inputs:['缺来源'],warnings:[],task_payload:{candidates:[]}}),usage:{input_tokens:10,output_tokens:20,total_tokens:30}};})).handler});}
async function runJob(j:Jobs){await j.dispatch();const job=(await j.claim('general'))!;assert.ok(job);await j.process(job);return job;}
test('API幂等受理冻结输入，Outbox/worker产生建议而不建立内容，契约响应可读',async()=>{
 const b=body(),key=crypto.randomUUID();const a=await client.call('/topic-generations','POST',b,{'Idempotency-Key':key}),again=await client.call('/topic-generations','POST',b,{'Idempotency-Key':key});assert.equal(a.data.request_id,again.data.request_id);
 const initial=(await client.call('/ai-requests/'+a.data.request_id)).data;assert.equal(initial.state,'queued');assert.equal(initial.result,null);
 await runJob(jobs());const final=(await client.call('/ai-requests/'+initial.id)).data;assert.equal(final.state,'succeeded');assert.equal(final.result.task_payload.candidates.length,0);assert.ok(final.ai_run_id);assert.equal((await env.db.query('SELECT count(*)::int n FROM retired.contents')).rows[0].n,0);
});
test('配置未启用和无效时段拒绝；未知请求不泄漏',async()=>{
 assert.equal((await client.call('/topic-generations','POST',{...body(),window:{start:'2026-01-01T00:00:00Z',end:'2026-03-01T00:00:00Z'}})).error.code,'WINDOW_INVALID');
 writeFileSync(dir+'/config.json',JSON.stringify({...config,enabled:false}),{mode:0o600});assert.equal((await client.call('/topic-generations','POST',body())).error.code,'AI_DISABLED');writeFileSync(dir+'/config.json',JSON.stringify(config),{mode:0o600});assert.equal((await client.call('/ai-requests/'+crypto.randomUUID())).status,404);
});
test('账号版本变化或模型失败不能落成成功结果，任务失败有明确代码',async()=>{
 const id=await queue();const job=await runJob(jobs(async()=>{await env.db.query('UPDATE accounts SET version=version+1 WHERE id=$1',[account.id]);}));assert.equal((await client.call('/ai-requests/'+id)).data.error_code,'STALE_INPUT');assert.equal((await env.db.query('SELECT state FROM jobs WHERE id=$1',[job.id])).rows[0].state,'failed');
 const bad=await queue();await runJob(jobs(undefined,true));const r=(await client.call('/ai-requests/'+bad)).data;assert.equal(r.state,'failed');assert.equal(r.error_code,'AI_UNAVAILABLE');assert.equal(r.result,null);
});
test('排队任务取消同步状态并不调用模型',async()=>{
 const id=await queue(),j=jobs();await j.dispatch();const job=(await env.db.query("SELECT * FROM jobs WHERE input->>'ai_request_id'=$1",[id])).rows[0];assert.equal((await client.call('/jobs/'+job.id+'/cancel','POST',{reason:'受控取消'})).status,200);const r=(await client.call('/ai-requests/'+id)).data;assert.equal(r.state,'cancelled');assert.equal(r.result,null);
});
test('处理器返回后到最终提交前发生竞争，guard原子拒绝旧结果',async()=>{
 const id=await queue(),j=jobs();await j.dispatch();const job=(await j.claim('general'))!;const tasks=new AITasks(env.db,()=>new AIGateway(env.db,config,async messages=>{const input=JSON.parse(messages[1]!.content);return {content:JSON.stringify({schema_version:input.schema_version,input_version:input.input_version,summary:'受控',evidence_refs:[],assumptions:[],missing_inputs:[],warnings:[],task_payload:{candidates:[]}}),usage:null};}));
 const output=await tasks.handler(job,new AbortController().signal);await env.db.query('UPDATE accounts SET version=version+1 WHERE id=$1',[account.id]);assert.equal(await j.complete(job,output.result,output.effects,undefined,output.completionState,output.guard),false);const r=(await client.call('/ai-requests/'+id)).data;assert.equal(r.error_code,'STALE_INPUT');assert.equal(r.result,null);
});

test('可用工时退出API与每周设置：旧参数拒绝，历史默认值不进入新任务',async()=>{
 const before=(await env.db.query('SELECT count(*)::int n FROM ai_requests')).rows[0].n;
 for(const capacity_hours of [0,8,null])assert.equal((await client.call('/topic-generations','POST',{...body(),capacity_hours})).status,422);
 const settings=(await client.call('/settings')).data;
 assert.equal((await client.call('/settings','PATCH',{category:'capacity',settings:{hours_per_week:8},expected_version:settings.version})).status,422);
 assert.equal((await env.db.query('SELECT count(*)::int n FROM ai_requests')).rows[0].n,before);
 await env.db.query("UPDATE workspaces SET settings=jsonb_set(settings,'{capacity}','{\"hours_per_week\":40}') WHERE id=$1",[me.workspace.id]);
 const id=await queue();const snapshot=(await env.db.query('SELECT snapshot FROM ai_requests WHERE id=$1',[id])).rows[0].snapshot;
 assert.equal(Object.hasOwn(snapshot,'capacity_hours'),false);
 assert.equal((await client.call('/settings')).data.settings.capacity.hours_per_week,40);
 await runJob(jobs());assert.equal((await client.call('/ai-requests/'+id)).data.state,'succeeded');
});
test('旧排队快照保留但送模型时去除可用工时，新版本不复用旧提示缓存',async()=>{
 const id=await queue();const snapshot=(await env.db.query('SELECT snapshot FROM ai_requests WHERE id=$1',[id])).rows[0].snapshot;snapshot.capacity_hours=8;
 await env.db.query('UPDATE ai_requests SET snapshot=$2,input_version=$3 WHERE id=$1',[id,JSON.stringify(snapshot),sha(canonical(snapshot))]);
 let calls=0;const j=new Jobs(env.db,{'ai.generate':new AITasks(env.db,()=>new AIGateway(env.db,config,async messages=>{
  calls++;const input=JSON.parse(messages[1]!.content);assert.equal(Object.hasOwn(input.data,'capacity_hours'),false);assert.equal(Object.hasOwn(input.data,'capacity'),false);
  assert.ok(!messages[0]!.content.includes('基于给定证据/栏目/产能'));assert.ok(!messages[0]!.content.includes('产能未知保留缺口'));
  return {content:JSON.stringify({schema_version:input.schema_version,input_version:input.input_version,summary:'已移除可用工时',evidence_refs:[],assumptions:[],missing_inputs:[],warnings:[],task_payload:{candidates:[]}}),usage:null};
 })).handler});
 await runJob(j);assert.equal(calls,1);const r=(await client.call('/ai-requests/'+id)).data;assert.equal(r.state,'succeeded');
 assert.equal((await env.db.query('SELECT snapshot FROM ai_requests WHERE id=$1',[id])).rows[0].snapshot.capacity_hours,8);
 assert.equal((await env.db.query('SELECT prompt_version FROM ai_runs WHERE id=$1',[r.ai_run_id])).rows[0].prompt_version,'yoyo-v1.2.5');
});
