/** Real API + independent Compose workers + provider; isolated synthetic business only. */
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const project='yoyo-s3-ai-smoke',base='http://127.0.0.1:59040',origin='http://localhost:59040';
const report={started_at:new Date().toISOString(),project,input_kind:'explicit synthetic account and no assets/sources; no publication',actual_model_calls:true,cases:[],checks:[]};
function compose(args,input){const r=spawnSync('docker',['compose','-p',project,...args],{input,encoding:'utf8',env:{...process.env,YOYO_PORT:'59040',S3_PORT:'59041',S3_PUBLIC_ENDPOINT:'http://localhost:59041',APP_ORIGIN:origin}});if(r.status!==0)throw new Error('COMPOSE_COMMAND_FAILED');return r.stdout.trim();}
let cookie='',csrf='';
async function call(path,method='GET',body){
 const response=await fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie,...(method==='GET'?{}:{Origin:origin,'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID()})},...(method==='GET'?{}:{body:JSON.stringify(body??{})})});
 const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];const value=await response.json();if(value.data?.csrf_token)csrf=value.data.csrf_token;
 if(!response.ok)throw new Error(value.error?.code??'HTTP_FAILED');return value.data;
}
async function waitRequest(id){const deadline=Date.now()+180000;while(Date.now()<deadline){const r=await call('/ai-requests/'+id);if(['succeeded','failed','cancelled'].includes(r.state)){if(r.state!=='succeeded')throw new Error(r.error_code??'AI_FAILED');return r;}await new Promise(r=>setTimeout(r,1000));}throw new Error('SMOKE_OBSERVATION_TIMEOUT');}
try{
 const config=JSON.parse(readFileSync('.local/ai/deepseek.json','utf8'));config.enabled=true;config.timeout_seconds=90;config.max_output_tokens=16000;
 compose(['exec','-T','worker','node','dist/tools/ai-config.js','set'],JSON.stringify(config));
 const setupToken=compose(['exec','-T','worker','node','dist/tools/setup-token.js']);
 const email=`compose-${randomUUID()}@example.invalid`,password=randomUUID()+'-Test-a9';
 await call('/auth/csrf');await call('/setup','POST',{setup_token:setupToken,email,password,display_name:'明确合成容器验收',workspace_name:'S3独立容器验收'});
 await call('/auth/csrf');await call('/auth/login','POST',{email,password});
 const account=await call('/accounts','POST',{platform:'xiaohongshu',platform_user_id:'synthetic-compose-s3',name:'明确合成容器账号'});
 const accepted=await call('/topic-generations','POST',{account_id:account.id,window:{start:new Date(Date.now()-86400000).toISOString(),end:new Date().toISOString()},columns:['日常观察'],capacity_hours:4});
 const topicsRequest=await waitRequest(accepted.request_id),topics=(await call('/topics?account_id='+account.id)).items;
 report.checks.push({name:'API_Outbox_worker_provider_topics',passed:topics.length>=2,request_id:topicsRequest.id,candidate_count:topics.length,schema_version:topicsRequest.result?.schema_version});if(topics.length<2)throw new Error('INSUFFICIENT_TOPICS');
 for(const [index,kind] of ['graphic','video'].entries()){
  const topic=topics[index],adopted=await call('/topics/'+topic.id+'/accept','POST',{expected_version:topic.version,media_type:kind});
  const before=await call('/contents/'+adopted.content_id),requestId=before.generation_requests[0].id;
  const request=await waitRequest(requestId),content=await call('/contents/'+adopted.content_id),candidate=content.revisions.find(r=>r.origin==='ai_candidate');
  const unchanged=content.current_revision_id===adopted.revision_id;
  if(!candidate?.frozen||!unchanged)throw new Error('CANDIDATE_OVERWROTE_DRAFT');
  const applied=await call('/contents/'+content.id+'/apply-generated','POST',{result_revision_id:candidate.id,expected_version:content.version});
  report.cases.push({kind,request_id:request.id,state:request.state,candidate_frozen:candidate.frozen,original_draft_unchanged:unchanged,applied_revision_id:applied.current_revision_id??applied.revision_id,output:request.result});
  if((await call('/contents/'+content.id)).current_revision_id===adopted.revision_id)throw new Error('CANDIDATE_NOT_APPLIED');
 }
 const ledger=JSON.parse(compose(['exec','-T','worker','node','-e',"const {Database}=require('./dist/packages/db/src/db.js');(async()=>{const db=new Database();console.log(JSON.stringify((await db.query('SELECT r.workflow,r.prompt_version,r.state,a.attempt,a.usage,a.cost_basis FROM ai_runs r JOIN ai_attempts a ON a.run_id=r.id ORDER BY r.started_at,a.attempt')).rows));await db.close()})().catch(()=>process.exit(1))"]));
 report.ledger=ledger;report.image_id=compose(['images','-q','worker']);report.checks.push({name:'graphic_video_candidate_apply',passed:report.cases.length===2});report.passed=true;
}catch(e){report.error_code=/^[A-Z_]+$/.test(e.message)?e.message:'COMPOSE_BUSINESS_SMOKE_FAILED';report.passed=false;process.exitCode=1;}
finally{
 try{compose(['exec','-T','worker','node','-e',"const fs=require('fs');if(fs.existsSync(process.env.AI_CONFIG_FILE))fs.unlinkSync(process.env.AI_CONFIG_FILE)"]);report.secret_cleanup=true;}catch{report.secret_cleanup=false;report.passed=false;process.exitCode=1;}
 report.finished_at=new Date().toISOString();writeFileSync('docs/evidence/s3/compose-business-smoke.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,error_code:report.error_code,cases:report.cases.length,secret_cleanup:report.secret_cleanup}));
}
