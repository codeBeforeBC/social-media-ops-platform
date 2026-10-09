/** S0 provider capability probe only; no S7 product/report implementation. */
import {writeFileSync} from 'node:fs';
import {z} from 'zod';
import {server,initialize,Client} from '../../tests/helpers';
import {AIGateway,loadAIConfig,commonOutput} from '../../packages/domain/src/ai-gateway';
import {sha,canonical} from '../../packages/domain/src/protocol';
async function main(){
 const env=await server(),report:any={started_at:new Date().toISOString(),scope:'S0 actual-provider structured calculation citation probe; explicitly synthetic, not S7 product or real backend verification'};
 try{
  const me=await initialize(new Client(env.url)),calculationId='b1000000-0000-4000-8000-000000000001',observations=['b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002'];
  const counts=[100,50],claim=`两个合成笔记的阅读数合计为${counts.reduce((a,b)=>a+b,0)}`;
  const input={synthetic:true,observations:observations.map((id,i)=>({id,note_id:'synthetic-note-'+i,read_count:counts[i],followers:null,traffic:'mixed_paid_natural'})),calculations:[{id:calculationId,claim,method:'sum of two distinct synthetic notes',value:counts.reduce((a,b)=>a+b,0),observation_ids:observations}],missing:['真实后台样本','粉丝与归因数据'],owner_role:'本地使用者'};
  const schema=z.object({...commonOutput,task_payload:z.object({facts:z.array(z.object({claim:z.literal(claim),calculation_id:z.literal(calculationId),observation_ids:z.array(z.string().uuid()).length(2)}).strict()).length(1),hypotheses:z.array(z.object({reason:z.string(),supporting_refs:z.array(z.string().uuid()),alternative_explanations:z.array(z.string())}).strict()).max(3),actions:z.array(z.object({change:z.string(),owner_role:z.string(),effort:z.string(),success_metric:z.string(),observation_window:z.string()}).strict()).max(3),missing_data:z.array(z.string()),confidence_notes:z.array(z.string())}).strict()}).strict();
  const config=loadAIConfig(),gateway=new AIGateway(env.db,{...config,enabled:true,timeout_seconds:90,max_output_tokens:16000});
  const result=await gateway.run({workspaceId:me.workspace.id,memberId:me.membership.id},{workflow:'s0.calculation-provider-probe',promptVersion:'s0-calculation-v1',schemaVersion:'ai-v1',instructions:'这是明确合成的提供方验证，不是运营复盘。facts只用给出的计算记录，claim逐字保存。指标缺失不能补数，混合流量不能写自然涨粉，不从两个样本作因果结论。hypotheses与actions只是待验证提案，不声称已执行；缺followers和真实后台样本需明确记录。不要建议投放或承诺业务效果。',schema,input,inputVersion:sha(canonical(input)),inputRefs:{calculationId,observations},allowedIds:{evidence_refs:[],calculation_id:[calculationId],observation_ids:observations,supporting_refs:[calculationId,...observations]},validate:o=>o.task_payload.facts.some(f=>new Set(f.observation_ids).size!==2)?['OBSERVATIONS_MISMATCH']:[]},new AbortController().signal);
  report.model=config.model;report.input=input;report.output=result.output;report.usage=(await env.db.query('SELECT attempt,state,usage,cost_basis,estimated_cost FROM ai_attempts WHERE run_id=$1 ORDER BY attempt',[result.runId])).rows;report.state='succeeded';
 }catch{report.state='failed';process.exitCode=1;}
 finally{report.finished_at=new Date().toISOString();writeFileSync('docs/evidence/s3/s0-calculation-provider-probe.json',JSON.stringify(report,null,2)+'\n');await env.close();}
}
main().catch(()=>{console.error('CALCULATION_PROVIDER_PROBE_FAILED');process.exitCode=1;});
