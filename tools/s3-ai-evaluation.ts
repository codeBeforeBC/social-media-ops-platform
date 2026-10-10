/** Fixed, explicit synthetic business evaluation. Actual model calls; no production actions. */
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {Client,initialize,server} from '../tests/helpers';
import {AIGateway,loadAIConfig,AIFailure} from '../packages/domain/src/ai-gateway';
import {evaluationCases,evaluationVersion} from './s3/evaluation-fixtures';
import {checkEvaluation} from './s3/evaluation-checks';
async function main(){const path=process.env.AI_EVALUATION_REPORT??'docs/evidence/s11/ai-evaluation-live.json';
 const prior=process.env.AI_EVALUATION_RESUME==='1'&&existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;
 if(prior&&(prior.evaluation_version!==evaluationVersion||prior.cases.some((r:any)=>{const c=evaluationCases.find(c=>c.definition.id===r.id);return !c||r.input_hash!==c.input.inputVersion||r.prompt_version!==c.spec.promptVersion||r.schema_version!==c.spec.schemaVersion;})))throw new Error('EVALUATION_RESUME_VERSION_MISMATCH');
 const config=loadAIConfig();if(prior&&prior.model!==config.model)throw new Error('EVALUATION_RESUME_MODEL_MISMATCH');
 const env=await server();
 const report:any=prior??{started_at:new Date().toISOString(),environment:'isolated *_test database',input_kind:'explicit_synthetic_sources_metrics_and_attacks; not_live_platform_samples',actual_model_calls:true,evaluation_version:evaluationVersion,cases:[],quality_review:'pending'};
 const save=()=>writeFileSync(path,JSON.stringify(report,null,2)+'\n');
 try{const me=await initialize(new Client(env.url)),gateway=new AIGateway(env.db,{...config,enabled:true,timeout_seconds:90,max_output_tokens:16000});report.model=config.model;save();
 for(const c of evaluationCases){if(process.env.AI_EVALUATION_IDS&&!process.env.AI_EVALUATION_IDS.split(',').includes(c.definition.id))continue;if(prior?.cases.some((r:any)=>r.id===c.definition.id&&r.finished_at&&['succeeded','failed'].includes(r.state)))continue;
 const unfinished=report.cases.findIndex((r:any)=>r.id===c.definition.id&&!r.finished_at);if(unfinished>=0){report.interrupted_cases??=[];report.interrupted_cases.push(report.cases.splice(unfinished,1)[0]);}
 const record:any={...c.definition,input:c.data,input_hash:c.input.inputVersion,prompt_version:c.spec.promptVersion,schema_version:c.spec.schemaVersion,started_at:new Date().toISOString()};report.cases.push(record);save();
 try{const result=await gateway.run({workspaceId:me.workspace.id,memberId:me.membership.id},c.spec as any,new AbortController().signal);record.run_id=result.runId;record.state='succeeded';record.output=result.output;const checked=checkEvaluation(c,result.output);record.hard_errors=checked.hard_errors;record.merged_payload=checked.merged_payload;record.semantic_review=checked.semantic_review;}
 catch(e){record.state='failed';record.error_code=e instanceof AIFailure?e.code:'EVALUATION_EXECUTION_FAILED';record.issues=e instanceof AIFailure?e.issues:[];}
 record.attempts=(await env.db.query('SELECT a.attempt,a.state,a.usage,a.cost_basis,a.estimated_cost,a.duration_ms FROM ai_attempts a JOIN ai_runs r ON r.id=a.run_id WHERE r.workspace_id=$1 AND r.input_hash=$2 ORDER BY a.started_at',[me.workspace.id,c.input.inputVersion])).rows;
 record.finished_at=new Date().toISOString();save();console.log(JSON.stringify({id:record.id,state:record.state,hard_errors:record.hard_errors??null}));
 }
 }finally{report.finished_at=new Date().toISOString();report.completed_cases=report.cases.filter((c:any)=>c.finished_at).length;save();await env.close();}
 if(report.cases.some((c:any)=>c.state!=='succeeded'||c.hard_errors?.length))process.exitCode=1;
}
main().catch(()=>{console.error('AI_EVALUATION_FAILED');process.exitCode=1;});
