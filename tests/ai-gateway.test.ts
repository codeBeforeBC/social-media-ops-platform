import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Client,initialize,server} from './helpers';
import {AIConfig,AIGateway,AISpec,AITransport,commonOutput,AIFailure,whitelistIssues} from '../packages/domain/src/ai-gateway';
let env:Awaited<ReturnType<typeof server>>,context:{workspaceId:string;memberId:string};
before(async()=>{env=await server();const me=await initialize(new Client(env.url));context={workspaceId:me.workspace.id,memberId:me.membership.id};});
after(()=>env.close());
const config:AIConfig={provider:'deepseek',base_url:'https://api.deepseek.com',model:'controlled',api_key:'controlled-secret-not-real',enabled:true,allowed_data_types:'any_user_authorized',budget:{mode:'unlimited_user_authorized',per_task:null,daily:null},authorization_date:'2026-10-08',timeout_seconds:2,max_output_tokens:1000};
const schema=z.object({...commonOutput,task_payload:z.object({asset_version_ids:z.array(z.string().uuid()),count:z.number().int().nonnegative()}).strict()}).strict();
type Output=z.infer<typeof schema>;
function spec():AISpec<Output>{return {workflow:'controlled-test',promptVersion:'v1',schemaVersion:'v1',instructions:'只生成受控测试数据',schema,input:{data:'明确合成样本'},inputVersion:randomUUID(),inputRefs:[],allowedIds:{evidence_refs:[],asset_version_ids:[]}};}
function response(s:AISpec<Output>,extra:Partial<Output>={}){return {content:JSON.stringify({schema_version:s.schemaVersion,input_version:s.inputVersion,summary:'测试',evidence_refs:[],assumptions:['合成测试'],missing_inputs:[],warnings:[],task_payload:{asset_version_ids:[],count:0},...extra}),usage:{input_tokens:10,output_tokens:20,total_tokens:30}};}
function gateway(transport:AITransport,overrides:Partial<AIConfig>={}){return new AIGateway(env.db,{...config,...overrides},transport);}
const signal=()=>new AbortController().signal;
test('合法结构缓存复用；输入/模型/提示词/允许ID变化均失效，记录真实用量而未知费用不填零',async()=>{
 const s=spec();let calls=0;const g=gateway(async()=>{calls++;return response(s);});const first=await g.run(context,s,signal()),second=await g.run(context,s,signal());assert.equal(calls,1);assert.equal(second.cached,true);assert.equal(first.runId,second.runId);
 for(const change of [{input:{data:'新输入'}},{promptVersion:'v2'},{allowedIds:{...s.allowedIds,asset_version_ids:[randomUUID()]}}]){const fresh=await g.run(context,{...s,...change},signal());assert.equal(fresh.cached,false);}assert.equal(calls,4);
 const attempts=(await env.db.query('SELECT * FROM ai_attempts WHERE run_id=$1',[first.runId])).rows;assert.equal(attempts.length,1);assert.equal(attempts[0].usage.total_tokens,30);assert.equal(attempts[0].estimated_cost,null);assert.equal(attempts[0].cost_basis,'unknown');
 const different=await gateway(async()=>response(s),{model:'other-controlled-model'}).run(context,s,signal());assert.equal(different.cached,false);
});
test('单次修复结构错误；禁止伪造ID，最终失败无结果',async()=>{
 const s=spec();let calls=0;const repaired=await gateway(async messages=>{calls++;if(calls===1)return {content:'invalid',usage:null};assert.match(messages.at(-1)!.content,/修复/);return response(s);}).run(context,s,signal());assert.equal(calls,2);assert.equal(repaired.output.task_payload.count,0);
 const bad=spec();let invalidCalls=0;await assert.rejects(gateway(async()=>{invalidCalls++;return response(bad,{task_payload:{asset_version_ids:[randomUUID()],count:0}});}).run(context,bad,signal()),(e:AIFailure)=>e.code==='AI_OUTPUT_INVALID');assert.equal(invalidCalls,2);
 const row=(await env.db.query('SELECT * FROM ai_runs WHERE input_version=$1',[bad.inputVersion])).rows[0];assert.equal(row.state,'failed');assert.equal(row.result,null);assert.match(JSON.stringify(row.validation),/ID_NOT_ALLOWED/);
});
test('业务校验必须通过；输入/Schema版本输出必须一致',async()=>{
 const s=spec();s.validate=o=>o.task_payload.count>0?['FORGED_COUNT']:[];await assert.rejects(gateway(async()=>response(s,{task_payload:{asset_version_ids:[],count:999}})).run(context,s,signal()),(e:AIFailure)=>e.code==='AI_OUTPUT_INVALID');
 const wrong=spec();await assert.rejects(gateway(async()=>response(wrong,{input_version:'wrong',schema_version:'wrong'})).run(context,wrong,signal()),(e:AIFailure)=>e.code==='AI_OUTPUT_INVALID');
});
test('同输入并发只发一次模型调用；运行锁保留，显式失败后能重试',async()=>{
 const s=spec();let release:()=>void=()=>{},calls=0;const gate=new Promise<void>(r=>release=r);const g=gateway(async()=>{calls++;await gate;return response(s);});const first=g.run(context,s,signal());
 while(!calls)await new Promise(r=>setTimeout(r,5));await assert.rejects(g.run(context,s,signal()),(e:AIFailure)=>e.code==='AI_ALREADY_RUNNING');release();await first;assert.equal(calls,1);
 const failed=spec();await assert.rejects(gateway(async()=>{throw new AIFailure('AI_UNAVAILABLE');}).run(context,failed,signal()));assert.equal((await gateway(async()=>response(failed)).run(context,failed,signal())).cached,false);
});
test('取消/超时拒绝结果，包括忽视signal的provider；取消不会进入缓存',async()=>{
 const s=spec(),controller=new AbortController();let started:()=>void=()=>{};const startedPromise=new Promise<void>(r=>started=r);const g=gateway(async()=>{started();await new Promise(()=>{});return response(s);});const run=g.run(context,s,controller.signal);await startedPromise;controller.abort();await assert.rejects(run,(e:AIFailure)=>e.code==='AI_CANCELLED');
 const row=(await env.db.query('SELECT state,result FROM ai_runs WHERE input_version=$1',[s.inputVersion])).rows[0];assert.equal(row.state,'cancelled');assert.equal(row.result,null);
 const slow=spec();await assert.rejects(gateway(async()=>new Promise(()=>{}),{timeout_seconds:1}).run(context,slow,signal()),(e:AIFailure)=>e.code==='AI_TIMEOUT');
});
test('预算在调用前拒绝并发超支；单价估算与供应商账单明确区分',async()=>{
 const s=spec();let calls=0;const pricing={currency:'CNY',version:'controlled-not-provider-price',input_per_million:100,output_per_million:200};
 await assert.rejects(gateway(async()=>{calls++;return response(s);},{pricing,budget:{mode:'limited',per_task:0.001,daily:0.001}}).run(context,s,signal()),(e:AIFailure)=>e.code==='AI_BUDGET_CURRENCY_CHANGED'||e.code==='AI_BUDGET_EXCEEDED');assert.equal(calls,0);
 const priced=spec(),g=gateway(async()=>response(priced),{pricing});const result=await g.run(context,priced,signal());const attempt=(await env.db.query('SELECT * FROM ai_attempts WHERE run_id=$1',[result.runId])).rows[0];assert.equal(Number(attempt.estimated_cost),0.005);assert.equal(attempt.cost_basis,'configured_rate_estimate');
});
test('缺配置禁用/权限或未知ID字段明确失败；模型错误不包含原始provider敏感文本',async()=>{
 const s=spec();await assert.rejects(gateway(async()=>response(s),{enabled:false}).run(context,s,signal()),(e:AIFailure)=>e.code==='AI_DISABLED');
 assert.deepEqual(whitelistIssues({surprise_id:randomUUID()},{}),['/surprise_id:ID_FIELD_NOT_ALLOWED']);
 await assert.rejects(gateway(async()=>{throw new Error('provider-secret-cookie');}).run(context,s,signal()),(e:AIFailure)=>e.code==='AI_UNAVAILABLE'&&!e.message.includes('secret'));
});
test('独立预算空间的并发预留真正拒绝超支，一次修复累计计入单任务预算',async()=>{
 const workspace=randomUUID(),member=randomUUID();const user=(await env.db.query('SELECT user_id FROM memberships WHERE id=$1',[context.memberId])).rows[0].user_id;
 await env.db.query("INSERT INTO workspaces(id,name) VALUES($1,'预算受控测试')",[workspace]);await env.db.query("INSERT INTO memberships(id,workspace_id,user_id,roles) VALUES($1,$2,$3,ARRAY['admin'])",[member,workspace,user]);const isolated={workspaceId:workspace,memberId:member};
 const pricing={currency:'CNY',version:'controlled-price',input_per_million:0,output_per_million:100};const limited={pricing,budget:{mode:'limited' as const,per_task:1,daily:0.1}};
 const s=spec();let release:()=>void=()=>{},called:()=>void=()=>{},calls=0;const start=new Promise<void>(r=>called=r),gate=new Promise<void>(r=>release=r);
 const g=gateway(async()=>{calls++;called();await gate;return response(s);},limited);const first=g.run(isolated,s,signal());await start;
 await assert.rejects(g.run(isolated,spec(),signal()),(e:AIFailure)=>e.code==='AI_BUDGET_EXCEEDED');assert.equal(calls,1);release();await first;
 const repair=spec();let repairCalls=0;await assert.rejects(gateway(async()=>{repairCalls++;return {content:'bad JSON',usage:{input_tokens:10,output_tokens:20,total_tokens:30}};},{pricing,budget:{mode:'limited',per_task:0.101,daily:1}}).run(isolated,repair,signal()),(e:AIFailure)=>e.code==='AI_BUDGET_EXCEEDED');assert.equal(repairCalls,1);
});
test('嵌套证据对象只校验真正的source_item_id，未知来源不能借对象绕过白名单',()=>{
 const allowed=randomUUID();assert.deepEqual(whitelistIssues({evidence_refs:[{source_item_id:allowed}]},{evidence_refs:[allowed],source_item_id:[allowed]}),[]);
 assert.deepEqual(whitelistIssues({evidence_refs:[{source_item_id:randomUUID()}]},{evidence_refs:[allowed],source_item_id:[allowed]}),['/evidence_refs/0/source_item_id:ID_NOT_ALLOWED']);
});
test('Job取消把信号传给AI调用；基础版本变化拒绝候选应用',async()=>{
 const {Jobs}=await import('../packages/domain/src/jobs');const s=spec();let ready:()=>void=()=>{},aborted=false,effects=0;const called=new Promise<void>(r=>ready=r);
 const g=gateway(async(_messages,_config,signal)=>{ready();await new Promise<void>((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new AIFailure('AI_CANCELLED'));},{once:true}));return response(s);});
 const jobs=new Jobs(env.db,{'test.ai':async(job,signal)=>{const result=await g.run({...context,jobId:job.id},s,signal);return {result,effects:async()=>{effects++;}};}});
 await env.db.query("INSERT INTO jobs(workspace_id,created_by,type,pool,request_id) VALUES($1,$2,'test.ai','general',$3)",[context.workspaceId,context.memberId,randomUUID()]);const job=(await jobs.claim('general'))!;const pending=jobs.process(job);await called;
 await env.db.query("UPDATE jobs SET state='cancelled',cancel_requested=true,lease_token=NULL,lease_until=NULL WHERE id=$1",[job.id]);await pending;
 // process returns on signal rejection; the gateway's durable failure write may complete just after it.
 for(let i=0;i<20;i++){if((await env.db.query('SELECT state FROM ai_runs WHERE job_id=$1',[job.id])).rows[0]?.state==='cancelled')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(aborted,true);assert.equal(effects,0);assert.equal((await env.db.query('SELECT state FROM ai_runs WHERE job_id=$1',[job.id])).rows[0].state,'cancelled');
 const staleSpec=spec();const fast=new Jobs(env.db,{'test.ai.stale':async(j,signal)=>{const result=await gateway(async()=>response(staleSpec)).run({...context,jobId:j.id},staleSpec,signal);await env.db.query('UPDATE workspaces SET version=version+1 WHERE id=$1',[context.workspaceId]);return {result,effects:async()=>{effects++;}};}});
 const current=(await env.db.query('SELECT version FROM workspaces WHERE id=$1',[context.workspaceId])).rows[0].version;
 await env.db.query("INSERT INTO jobs(workspace_id,created_by,type,pool,input_version,request_id) VALUES($1,$2,'test.ai.stale','general',$3,$4)",[context.workspaceId,context.memberId,current,randomUUID()]);const stale=(await fast.claim('general'))!;await fast.process(stale);assert.equal(effects,0);assert.equal((await env.db.query('SELECT error_code FROM jobs WHERE id=$1',[stale.id])).rows[0].error_code,'STALE_INPUT');
});
test('跨空间身份/非运行Job拒绝调用；已死进程运行可恢复但不会覆盖原记录',async()=>{
 const s=spec();let calls=0;const g=gateway(async()=>{calls++;return response(s);});await assert.rejects(g.run({...context,workspaceId:randomUUID()},s,signal()),(e:AIFailure)=>e.code==='AI_SCOPE_INVALID');assert.equal(calls,0);
 await assert.rejects(g.run({...context,jobId:randomUUID()},s,signal()),(e:AIFailure)=>e.code==='AI_JOB_INACTIVE');assert.equal(calls,0);
 const first=await g.run(context,s,signal());await env.db.query("UPDATE ai_runs SET state='running',result=NULL,started_at=now()-interval '3 minutes' WHERE id=$1",[first.runId]);const recovered=await g.run(context,s,signal());assert.notEqual(recovered.runId,first.runId);assert.equal((await env.db.query('SELECT error_code FROM ai_runs WHERE id=$1',[first.runId])).rows[0].error_code,'AI_RUN_ABANDONED');
});
test('缓存每次复查Schema、允许引用、业务规则与版本，损坏缓存拒绝使用',async()=>{
 const s=spec(),g=gateway(async()=>response(s));const r=await g.run(context,s,signal());await env.db.query("UPDATE ai_runs SET result=jsonb_set(result,'{input_version}','\"corrupted\"') WHERE id=$1",[r.runId]);await assert.rejects(g.run(context,s,signal()),(e:AIFailure)=>e.code==='AI_CACHE_INVALID');
});
test('数据库Date在提示词与缓存版本中保留ISO时间，不变成空对象',async()=>{
 const {canonical}=await import('../packages/domain/src/protocol');const at=new Date('2026-10-08T01:02:03.456Z');assert.equal(canonical({captured_at:at}),canonical({captured_at:at.toISOString()}));const s=spec();s.input={captured_at:at};let calls=0;const g=gateway(async messages=>{calls++;assert.equal(JSON.parse(messages[1]!.content).data.captured_at,at.toISOString());return response(s);});await g.run(context,s,signal());const again=await g.run(context,{...s,input:{captured_at:at.toISOString()}},signal());assert.equal(again.cached,true);assert.equal(calls,1);
});

test('截断响应明确失败仍记真实tokens和费用，不把已收费调用当零消费',async()=>{
 const {deepseekTransport}=await import('../packages/domain/src/ai-gateway');const original=globalThis.fetch;
 try{globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'{"incomplete":'},finish_reason:'length'}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}}),{status:200});
  await assert.rejects(deepseekTransport([],config,signal()),(e:AIFailure)=>e.code==='AI_OUTPUT_TRUNCATED'&&e.providerUsage?.total_tokens===30);
 }finally{globalThis.fetch=original;}
 const s=spec();await assert.rejects(gateway(async()=>{throw new AIFailure('AI_OUTPUT_TRUNCATED',[],{input_tokens:10,output_tokens:20,total_tokens:30});},{pricing:{currency:'CNY',version:'controlled',input_per_million:100,output_per_million:200}}).run(context,s,signal()),(e:AIFailure)=>e.code==='AI_OUTPUT_TRUNCATED');
 const row=(await env.db.query('SELECT a.* FROM ai_attempts a JOIN ai_runs r ON r.id=a.run_id WHERE r.input_version=$1',[s.inputVersion])).rows[0];assert.equal(row.state,'failed');assert.equal(row.error_code,'AI_OUTPUT_TRUNCATED');assert.equal(row.usage.total_tokens,30);assert.equal(Number(row.estimated_cost),0.005);
});
