/** Real DeepSeek business-schema probes; synthetic input clearly separated from live source claims. */
import {writeFileSync} from 'node:fs';
import {Client,initialize,server} from '../tests/helpers';
import {AIGateway,loadAIConfig,AIFailure} from '../packages/domain/src/ai-gateway';
import {topicSpec,graphicSpec,videoSpec,WorkflowInput} from '../packages/domain/src/ai-workflows';
async function main(){
 const env=await server(),report:any={started_at:new Date().toISOString(),environment:'isolated *_test database',provider:'deepseek',input_kind:'explicit_synthetic_business_cases',actual_model_calls:true,probes:[],quality_review:'not_performed'};
 try{
  const me=await initialize(new Client(env.url)),config=loadAIConfig(),gateway=new AIGateway(env.db,{...config,enabled:true,timeout_seconds:90,max_output_tokens:4096});report.model=config.model;
  const input:WorkflowInput={input:{title:'YOYO雨天散步的小观察',audience:'喜欢轻松日常的年轻人',goal:'记录雨天发现并提出下次观察主题',columns:['日常观察'],capacity_hours:4,sources:[],assets:[],rules:['不声称任何数据或涨粉效果'],target_duration_ms:15000},inputVersion:'synthetic-business-v1',inputRefs:{synthetic:true},sourceIds:[],assetIds:[],assetVersionIds:[]};
  const specs=[topicSpec(input),graphicSpec(input),videoSpec(input)].filter(s=>!process.env.AI_PROBE_TYPES||process.env.AI_PROBE_TYPES.split(',').includes(s.workflow));
  report.expected_workflows=specs.map(s=>s.workflow);
  for(const spec of specs){
   const started=Date.now();try{const result=await gateway.run({workspaceId:me.workspace.id,memberId:me.membership.id},spec as any,new AbortController().signal);const again=await gateway.run({workspaceId:me.workspace.id,memberId:me.membership.id},spec as any,new AbortController().signal);const attempts=(await env.db.query('SELECT attempt,state,usage,estimated_cost,cost_basis,duration_ms FROM ai_attempts WHERE run_id=$1 ORDER BY attempt',[result.runId])).rows;
    report.probes.push({workflow:spec.workflow,state:'succeeded',run_id:result.runId,schema_version:spec.schemaVersion,prompt_version:spec.promptVersion,attempts,cache_reused:again.cached,elapsed_ms:Date.now()-started,output:result.output});
   }catch(e){report.probes.push({workflow:spec.workflow,state:'failed',error_code:e instanceof AIFailure?e.code:'PROBE_FAILED',issues:e instanceof AIFailure?e.issues:[],elapsed_ms:Date.now()-started});}
   console.log(JSON.stringify({workflow:spec.workflow,state:report.probes.at(-1).state}));
  }
 }finally{report.finished_at=new Date().toISOString();writeFileSync(process.env.AI_PROBE_REPORT??'docs/evidence/s3/ai-business-live-probe.json',JSON.stringify(report,null,2)+'\n');await env.close();}
 if(report.probes.length!==report.expected_workflows.length||report.probes.some((p:any)=>p.state!=='succeeded'||!p.cache_reused))process.exitCode=1;
}
main().catch(()=>{console.error('AI_LIVE_PROBE_FAILED');process.exitCode=1;});
