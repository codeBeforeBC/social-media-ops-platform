import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Client,initialize,server} from '../tests/helpers';
import {loadAIConfig} from '../packages/domain/src/ai-gateway';
import {AITasks} from '../packages/domain/src/ai-tasks';
import {Jobs} from '../packages/domain/src/jobs';
async function main(){
 const c=loadAIConfig(),dir=mkdtempSync(tmpdir()+'/yoyo-ai-live-'),previous=process.env.AI_CONFIG_FILE;
 writeFileSync(dir+'/config.json',JSON.stringify({...c,enabled:true,timeout_seconds:90,max_output_tokens:8192}),{mode:0o600});process.env.AI_CONFIG_FILE=dir+'/config.json';
 const env=await server(),report:any={started_at:new Date().toISOString(),environment:'isolated *_test database; API/Outbox/worker/DeepSeek',input_kind:'synthetic_account_and_no_sources',actual_model:true,model:c.model};
 try{
  const client=new Client(env.url);await initialize(client);const account=(await client.call('/accounts','POST',{platform:'xiaohongshu',platform_user_id:'synthetic-ai-probe',name:'明确合成验收账号'})).data;
  const accepted=await client.call('/topic-generations','POST',{account_id:account.id,window:{start:new Date(Date.now()-86400000).toISOString(),end:new Date().toISOString()},columns:['日常观察'],capacity_hours:4});report.accepted_status=accepted.status;if(accepted.status!==202)throw new Error('AI_ACCEPT_FAILED');
  const jobs=new Jobs(env.db,{'ai.generate':new AITasks(env.db).handler});await jobs.dispatch();const job=(await jobs.claim('general'))!;if(!job)throw new Error('AI_JOB_MISSING');await jobs.process(job);
  const request=(await client.call('/ai-requests/'+accepted.data.request_id)).data;report.request={id:request.id,state:request.state,error_code:request.error_code,input_version:request.input_version,job_id:request.job_id,ai_run_id:request.ai_run_id};
  report.attempts=(await env.db.query('SELECT attempt,state,usage,estimated_cost,cost_basis,duration_ms FROM ai_attempts WHERE run_id=$1 ORDER BY attempt',[request.ai_run_id])).rows;report.candidate_count=request.result?.task_payload?.candidates?.length??null;report.persisted_topics=(await env.db.query('SELECT id,score,status,missing_inputs FROM topics WHERE generation_request_id=$1 ORDER BY candidate_position',[request.id])).rows;report.output=request.result;report.created_content_count=(await env.db.query('SELECT count(*)::int n FROM contents')).rows[0].n;report.quality_review='not_performed';
  if(request.state!=='succeeded'||report.created_content_count!==0)process.exitCode=1;
 }finally{report.finished_at=new Date().toISOString();writeFileSync(process.env.AI_WORKER_PROBE_REPORT??'docs/evidence/s3/ai-worker-live-probe.json',JSON.stringify(report,null,2)+'\n');await env.close();if(previous===undefined)delete process.env.AI_CONFIG_FILE;else process.env.AI_CONFIG_FILE=previous;rmSync(dir,{recursive:true});}
}
main().catch(()=>{console.error('AI_WORKER_PROBE_FAILED');process.exitCode=1;});
