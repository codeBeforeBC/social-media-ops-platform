/** Controlled model response for isolated browser DB; never calls an external provider. */
import {randomUUID} from 'node:crypto';
import {database} from '../tests/helpers';
import {Jobs} from '../packages/domain/src/jobs';
import {AITasks} from '../packages/domain/src/ai-tasks';
import {AIGateway,AIConfig} from '../packages/domain/src/ai-gateway';
const config:AIConfig={provider:'deepseek',base_url:'https://api.deepseek.com',model:'controlled-browser',api_key:'controlled-not-real-key',enabled:true,allowed_data_types:'any_user_authorized',budget:{mode:'unlimited_user_authorized',per_task:null,daily:null},authorization_date:'2026-10-08',timeout_seconds:2,max_output_tokens:1000};
async function main(){const db=await database();try{
 const jobs=new Jobs(db,{'ai.generate':new AITasks(db,()=>new AIGateway(db,config,async messages=>{const input=JSON.parse(messages[1]!.content);return {content:JSON.stringify({schema_version:input.schema_version,input_version:input.input_version,summary:'明确合成浏览器制作单',evidence_refs:[],assumptions:['合成浏览器验收'],missing_inputs:['缺实际素材'],warnings:[],task_payload:{goal:'模型建议目标',audience:'模型建议人群',pages:[{position:1,visual_instruction:'合成浏览器画面',page_copy:'合成浏览器页文案',asset_version_ids:[]}],title_options:['合成制作单标题'],body:'合成制作单正文',interaction_question:'你观察到了什么？',delivery_spec:'PNG',fact_check_items:[]}}),usage:{input_tokens:10,output_tokens:20,total_tokens:30}};})).handler});await jobs.dispatch();
 const target=(await db.query("SELECT j.id FROM jobs j JOIN ai_requests r ON r.id=(j.input->>'ai_request_id')::uuid JOIN contents c ON c.id=(r.snapshot->>'content_id')::uuid JOIN accounts a ON a.id=c.account_id WHERE a.platform_user_id='browser-platform-id' AND c.title='合成候选：采纳操作' AND j.state='queued' ORDER BY j.created_at DESC LIMIT 1")).rows[0];if(!target)throw new Error('FIXTURE_JOB_MISSING');
 const job=(await db.query("UPDATE jobs SET state='running',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '120 seconds',started_at=now() WHERE id=$1 AND state='queued' RETURNING *",[target.id,randomUUID()])).rows[0];await jobs.process(job);if((await db.query('SELECT state FROM jobs WHERE id=$1',[target.id])).rows[0].state!=='succeeded')throw new Error('FIXTURE_JOB_FAILED');
 }finally{await db.close();}}
main().catch(()=>{console.error('BRIEF_BROWSER_FIXTURE_FAILED');process.exitCode=1;});
