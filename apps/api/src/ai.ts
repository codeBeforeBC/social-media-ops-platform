import {z} from 'zod';
import {Database,Tx} from '../../../packages/db/src/db';
import {Actor,AppError,parse,uuid,text,sha,canonical,id} from '../../../packages/domain/src/protocol';
import {Commands,audit} from './commands';
import {loadAIConfig,AIFailure} from '../../../packages/domain/src/ai-gateway';
export class AIRequests {
 constructor(readonly db:Database){}
 async generateTopics(tx:Tx,a:Actor,input:unknown){
  const b=parse(z.object({account_id:uuid,window:z.object({start:z.iso.datetime({offset:true}),end:z.iso.datetime({offset:true})}).strict(),columns:z.array(text(200)).min(1).max(10),capacity_hours:z.number().min(0).max(168).nullable().optional()}).strict(),input);
  const start=Date.parse(b.window.start),end=Date.parse(b.window.end);if(end<=start||end-start>31*86400000||end>Date.now()+60000)throw new AppError(422,'WINDOW_INVALID','来源窗口应为过去31天内的有效时段');
  try{if(!loadAIConfig().enabled)throw new AIFailure('AI_DISABLED');}catch(e){throw new AppError(503,e instanceof AIFailure?e.code:'AI_NOT_CONFIGURED','AI配置不可用；仍可查看来源与已有内容');}
  const account=await new Commands(this.db).accountScope(tx,a,b.account_id,true);
  const workspace=(await tx.query('SELECT version,settings FROM workspaces WHERE id=$1',[a.workspaceId])).rows[0];
  const rule=(await tx.query("SELECT * FROM rule_sets WHERE workspace_id=$1 AND status='active'",[a.workspaceId])).rows[0];
  const rules=rule?(await tx.query('SELECT id,category,rule_text,source_page,severity FROM brand_rules WHERE rule_set_id=$1 ORDER BY id',[rule.id])).rows:[];
  const sources=(await tx.query(`SELECT i.id,i.title,i.summary,i.published_at,i.captured_at,i.actual_source_type,i.reference_only,c.source_type pipeline_type,o.id observation_id,i.content_hash FROM source_items i JOIN source_connections c ON c.id=i.connection_id JOIN LATERAL(SELECT id FROM source_observations WHERE source_item_id=i.id AND content_hash=i.content_hash AND captured_at=i.captured_at ORDER BY captured_at DESC,id DESC LIMIT 1)o ON true WHERE i.workspace_id=$1 AND i.availability='observed' AND i.captured_at>=$2 AND i.captured_at<$3 ORDER BY i.captured_at DESC,i.id LIMIT 50`,[a.workspaceId,b.window.start,b.window.end])).rows;
  const assets=(await tx.query("SELECT av.id asset_version_id,ast.id asset_id,ast.name,ast.category,ast.tags,ast.version asset_version,ast.business_status,av.usage_scope FROM asset_versions av JOIN assets ast ON ast.id=av.asset_id WHERE ast.workspace_id=$1 AND ast.business_status='usable' AND av.permission_confirmed_at IS NOT NULL AND (av.valid_until IS NULL OR av.valid_until>now()) ORDER BY av.created_at DESC LIMIT 100",[a.workspaceId])).rows;
  const snapshot={account:{id:account.id,name:account.name,version:account.version},workspace_version:workspace.version,rule_set:rule?{id:rule.id,version:rule.version}:null,rules,sources,assets,columns:b.columns,capacity_hours:b.capacity_hours??workspace.settings?.capacity?.hours_per_week??null,window:b.window,language:'zh-CN',warnings:rule?[]:['缺少已生效规范，候选只能作为待确认原创建议']};
  const inputVersion=sha(canonical(snapshot)),requestId=id();
  await tx.query('INSERT INTO ai_requests(id,workspace_id,account_id,created_by,kind,input_version,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)',[requestId,a.workspaceId,account.id,a.memberId,'topics',inputVersion,JSON.stringify(snapshot)]);
  await tx.query("INSERT INTO outbox(workspace_id,account_id,event_key,event_type,payload) VALUES($1,$2,$3,'ai.generate',$4)",[a.workspaceId,account.id,'ai.request:'+requestId,JSON.stringify({created_by:a.memberId,pool:'general',request_id:a.requestId,input:{ai_request_id:requestId}})]);
  await audit(tx,a,'ai.request','ai_request',requestId,{kind:'topics',input_version:inputVersion,source_count:sources.length,asset_count:assets.length});
  return {status:202,data:{request_id:requestId,state:'queued',status_url:'/api/v1/ai-requests/'+requestId}};
 }
 async get(a:Actor,requestId:string){
  parse(uuid,requestId);const r=await this.db.query('SELECT * FROM ai_requests WHERE workspace_id=$1 AND id=$2',[a.workspaceId,requestId]);if(!r.rowCount)throw new AppError(404,'NOT_FOUND','任务不存在或不可见');await new Commands(this.db).accountScope(this.db,a,r.rows[0].account_id);
  const jobs=await this.db.query("SELECT id,state,error_code FROM jobs WHERE workspace_id=$1 AND (input->>'ai_request_id')=$2 ORDER BY created_at DESC LIMIT 1",[a.workspaceId,requestId]);const job=jobs.rows[0];
  if(job&&['failed','cancelled'].includes(job.state)&&['queued','running'].includes(r.rows[0].state))await this.db.query('UPDATE ai_requests SET state=$2,error_code=$3,job_id=$4,finished_at=now() WHERE id=$1',[requestId,job.state,job.error_code,job.id]);
  const row=(await this.db.query('SELECT id,account_id,kind,state,input_version,job_id,ai_run_id,result_revision_id,result,error_code,created_at,finished_at FROM ai_requests WHERE id=$1',[requestId])).rows[0];
  return {...row,job_id:row.job_id??job?.id??null};
 }
}
