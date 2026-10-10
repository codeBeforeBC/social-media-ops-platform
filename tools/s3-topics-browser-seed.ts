/** Explicitly synthetic browser candidates; no model calls or production database. */
import {database} from '../tests/helpers';
import {saveTopics} from '../packages/domain/src/topics';
import {scoreCriteria} from '../packages/domain/src/ai-workflows';
import {canonical,sha} from '../packages/domain/src/protocol';
async function main(){const db=await database();try{
 const account=(await db.query("SELECT * FROM accounts WHERE platform_user_id='browser-platform-id'")).rows[0],workspace=(await db.query('SELECT version FROM workspaces WHERE id=$1',[account.workspace_id])).rows[0];
 const source=(await db.query("SELECT i.*,o.id observation_id FROM source_items i JOIN source_observations o ON o.source_item_id=i.id WHERE i.external_id='browser-source-test' ORDER BY o.captured_at DESC LIMIT 1")).rows[0];
 const snapshot={scope_version:'v1.2',account:{id:account.id,name:account.name,version:account.version},workspace_version:workspace.version,sources:[{id:source.id,title:source.title,summary:source.summary,observation_id:source.observation_id,captured_at:source.captured_at,pipeline_type:'weibo_hot',content_hash:source.content_hash}],capacity_hours:4};const version=sha(canonical(snapshot));
 const request=(await db.query("INSERT INTO ai_requests(workspace_id,account_id,created_by,kind,input_version,snapshot,state) VALUES($1,$2,$3,'topics',$4,$5,'succeeded') RETURNING *",[account.workspace_id,account.id,account.owner_id,version,JSON.stringify(snapshot)])).rows[0];
 const make=(title:string)=>({title,audience:'测试人群',need:'验证操作',scene:'合成测试',column:'观察',emotion:'好奇',media_type:'graphic',follow_reason:'验证连续关注理由',evidence_refs:[{source_item_id:source.id,claim:source.title,evidence_kind:'fact'}],original_angle:'这是页面验收夹具，不是运营事实',score_breakdown:scoreCriteria.map(criterion=>({criterion,score:4,reason:'合成评分'})),estimated_hours:null,expires_at:null,assumptions:['明确合成的浏览器候选']});
 await db.transaction(tx=>saveTopics(tx,request,{schema_version:'ai-v1.2',input_version:version,summary:'合成',evidence_refs:[source.id],assumptions:[],missing_inputs:['缺受众反馈'],warnings:['合成验收夹具'],task_payload:{candidates:[make('合成候选：采纳操作'),make('合成候选：拒绝操作')]}}));
 }finally{await db.close();}}
main().catch(()=>{console.error('TOPIC_BROWSER_FIXTURE_FAILED');process.exitCode=1;});
