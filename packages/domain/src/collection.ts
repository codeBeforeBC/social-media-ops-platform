import {z} from 'zod';
import {Database,Tx} from '../../db/src/db';
import {Actor,AppError,id,parse,text,timezone,uuid,version} from './protocol';
import {JobHandler} from './jobs';

export type Connection=Record<string,any>;
export type CollectionResult={items:Record<string,any>[];coverage:Record<string,unknown>;warnings?:string[];capabilities?:Record<string,boolean|null>;adapter_version:string;captured_at?:string;next_cursor?:string|null;quota_state?:{provider_limit_known:boolean;provider_remaining:number|null;request_item_limit:number}};
export type Collector=(connection:Connection,signal:AbortSignal)=>Promise<CollectionResult>;
export class SourceFailure extends Error {
 constructor(readonly code:string,readonly diagnostics:Record<string,unknown>={}){super(code);}
}
const time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const settings=z.object({keywords:z.array(text(100)).min(1).max(10).optional(),profile:text(100).optional(),reference_accounts:z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(2).refine(v=>new Set(v.map(id=>id.toLowerCase())).size===v.length).optional(),max_items:z.number().int().min(1).max(50).optional()}).strict();
const editable={name:text(),schedule:z.array(time).max(4).refine(v=>new Set(v).size===v.length).optional(),timezone:timezone.optional(),enabled:z.boolean().optional(),min_interval_seconds:z.number().int().min(60).max(86400).optional(),config:settings.optional()};
export class Collection {
 constructor(readonly db:Database,readonly adapters:Record<string,Collector>={},readonly saveItems?:(tx:Tx,c:Connection,runId:string,result:CollectionResult)=>Promise<void>){}
 async scope(query:Pick<Database,'query'>|Tx,a:Actor,cid:string,lock=false){
  const r=await query.query(`SELECT * FROM source_connections WHERE workspace_id=$1 AND id=$2 ${lock?'FOR UPDATE':''}`,[a.workspaceId,parse(uuid,cid)]);
  if(!r.rowCount)throw new AppError(404,'NOT_FOUND','来源连接不存在或不可见');return r.rows[0];
 }
 async list(a:Actor){return {items:(await this.db.query('SELECT * FROM source_connections WHERE workspace_id=$1 ORDER BY created_at,id',[a.workspaceId])).rows,next_cursor:null};}
 async create(tx:Tx,a:Actor,input:unknown){
  const b=parse(z.object({...editable,platform:z.enum(['weibo','xiaohongshu']),source_type:z.enum(['weibo_hot','xhs_topic_signal','xhs_quality_note']),provider:z.enum(['weibo_web','opencli'])}).strict(),input);
  if((b.platform==='weibo')!==(b.source_type==='weibo_hot')||(b.platform==='weibo')!==(b.provider==='weibo_web'))throw new AppError(422,'SOURCE_TYPE_INVALID','来源类型与提供方不匹配');
  if(b.source_type!=='xhs_quality_note'&&b.config?.reference_accounts?.length)throw new AppError(422,'REFERENCE_ACCOUNT_SOURCE_INVALID','参考账号仅用于优质笔记来源');
  const r=await tx.query(`INSERT INTO source_connections(workspace_id,created_by,owner_id,platform,source_type,provider,name,config,schedule,timezone,enabled,min_interval_seconds) VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[a.workspaceId,a.memberId,b.platform,b.source_type,b.provider,b.name,JSON.stringify(b.config??{}),b.schedule??['09:00','16:00'],b.timezone??'Asia/Shanghai',b.enabled??false,b.min_interval_seconds??1800]);
  await this.audit(tx,a,'source.create',r.rows[0].id);return {status:201,data:r.rows[0]};
 }
 async patch(tx:Tx,a:Actor,cid:string,input:unknown){
  const b=parse(z.object({...editable,name:text().optional(),expected_version:version}).strict(),input);const c=await this.scope(tx,a,cid,true);
  if(c.version!==b.expected_version)throw new AppError(409,'VERSION_CONFLICT','来源配置已更新');
  if(c.source_type!=='xhs_quality_note'&&b.config?.reference_accounts?.length)throw new AppError(422,'REFERENCE_ACCOUNT_SOURCE_INVALID','参考账号仅用于优质笔记来源');
  const r=await tx.query(`UPDATE source_connections SET name=COALESCE($1,name),schedule=COALESCE($2,schedule),timezone=COALESCE($3,timezone),enabled=COALESCE($4,enabled),min_interval_seconds=COALESCE($5,min_interval_seconds),config=COALESCE($6,config),health=CASE WHEN $4=false THEN 'disabled' WHEN $6::jsonb IS NOT NULL OR ($4=true AND health='disabled') THEN 'unverified' ELSE health END,version=version+1,updated_at=now() WHERE id=$7 RETURNING *`,[b.name??null,b.schedule??null,b.timezone??null,b.enabled??null,b.min_interval_seconds??null,b.config===undefined?null:JSON.stringify(b.config),cid]);
  await this.audit(tx,a,'source.update',cid);return {status:200,data:r.rows[0]};
 }
 async enqueue(tx:Tx,c:Connection,actorId:string,requestId:string,trigger:'manual'|'scheduled'|'verify',slot:string|null=null){
  if(trigger!=='verify'&&(!c.enabled||c.paused))throw new AppError(409,'SOURCE_PAUSED','来源未启用或已暂停，请先验证恢复');
  const active=await tx.query("SELECT * FROM collection_runs WHERE connection_id=$1 AND state IN ('queued','running')",[c.id]);
  if(active.rowCount)return {run:active.rows[0],reused:true};
  if(c.last_attempt_at&&Date.now()-new Date(c.last_attempt_at).getTime()<c.min_interval_seconds*1000)throw new AppError(429,'SOURCE_RATE_LIMIT','刷新间隔未到，请稍后重试');
  if(slot){const old=await tx.query('SELECT * FROM collection_runs WHERE connection_id=$1 AND scheduled_slot=$2',[c.id,slot]);if(old.rowCount)return {run:old.rows[0],reused:true};}
  const run=(await tx.query(`INSERT INTO collection_runs(workspace_id,connection_id,created_by,connection_version,trigger,scheduled_slot) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[c.workspace_id,c.id,actorId,c.version,trigger,slot])).rows[0];
  await tx.query(`INSERT INTO outbox(workspace_id,event_key,event_type,payload) VALUES($1,$2,'source.collect',$3)`,[c.workspace_id,'collection:'+run.id,JSON.stringify({created_by:actorId,request_id:requestId,input:{run_id:run.id},pool:'general'})]);
  await tx.query('UPDATE source_connections SET last_attempt_at=now() WHERE id=$1',[c.id]);return {run,reused:false};
 }
 async refresh(tx:Tx,a:Actor,cid:string,verify=false){const c=await this.scope(tx,a,cid,true);const r=await this.enqueue(tx,c,a.memberId,a.requestId,verify?'verify':'manual');await this.audit(tx,a,verify?'source.verify':'source.refresh',cid,{run_id:r.run.id});return {status:202,data:r};}
 async runs(a:Actor,cid:string){await this.scope(this.db,a,cid);return {items:(await this.db.query('SELECT * FROM collection_runs WHERE connection_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',[cid])).rows};}
 async pause(tx:Tx,a:Actor,cid:string,input:unknown){const b=parse(z.object({expected_version:version,reason:text(1000)}).strict(),input);const c=await this.scope(tx,a,cid,true);if(c.version!==b.expected_version)throw new AppError(409,'VERSION_CONFLICT','来源配置已更新');const r=await tx.query("UPDATE source_connections SET paused=true,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",[cid]);await this.audit(tx,a,'source.pause',cid,{reason:b.reason});return {status:200,data:r.rows[0]};}
 async tick(now=new Date()){
  await this.db.query(`UPDATE collection_runs r SET state=j.state,error_code=j.error_code,finished_at=now() FROM jobs j WHERE j.type='source.collect' AND j.input->>'run_id'=r.id::text AND r.state IN ('queued','running') AND j.state IN ('failed','cancelled')`);
  const connections=await this.db.query('SELECT * FROM source_connections WHERE enabled AND NOT paused ORDER BY id');
  for(const c of connections.rows){
   const parts=new Intl.DateTimeFormat('en-CA',{timeZone:c.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
   const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));const hm=`${p.hour}:${p.minute}`;
   // Only the current scheduled minute is eligible; missed slots are not falsely labelled as executed.
   if(!c.schedule.includes(hm))continue;const slot=`${p.year}-${p.month}-${p.day}T${hm}@${c.timezone}`;
   await this.db.transaction(async tx=>{const locked=(await tx.query('SELECT * FROM source_connections WHERE id=$1 FOR UPDATE',[c.id])).rows[0];if(!locked.enabled||locked.paused)return;const member=await tx.query('SELECT active FROM memberships WHERE id=$1',[locked.owner_id]);if(!member.rows[0]?.active)return;try{await this.enqueue(tx,locked,locked.owner_id,id(),'scheduled',slot);}catch(e){if(!(e instanceof AppError&&e.code==='SOURCE_RATE_LIMIT'))throw e;}});
  }
 }
 readonly handler:JobHandler=async(job,signal)=>{
  const run=(await this.db.query('SELECT * FROM collection_runs WHERE workspace_id=$1 AND id=$2',[job.workspace_id,job.input.run_id])).rows[0];
  if(!run)throw new Error('COLLECTION_RUN_MISSING');
  const c=(await this.db.query('SELECT * FROM source_connections WHERE id=$1',[run.connection_id])).rows[0];
  await this.db.query("UPDATE collection_runs SET state='running',job_id=$1,started_at=COALESCE(started_at,now()) WHERE id=$2 AND state IN ('queued','running')",[job.id,run.id]);
  let result:CollectionResult|undefined,error:string|null=null,diagnostics:Record<string,unknown>={};
  try{
   if(c.version!==run.connection_version||(run.trigger!=='verify'&&(!c.enabled||c.paused)))throw new SourceFailure('CONNECTION_CHANGED');
   const adapter=this.adapters[c.source_type];if(!adapter)throw new SourceFailure('ADAPTER_UNAVAILABLE');result=await adapter(c,signal);
  }catch(e){if(signal.aborted)throw new Error('JOB_TIMEOUT');error=e instanceof SourceFailure?e.code:'SOURCE_UNAVAILABLE';diagnostics=e instanceof SourceFailure?e.diagnostics:{};}
  const failure=error;const output=result;
  return {result:{run_id:run.id,item_count:output?.items.length??0,error_code:failure},completionState:failure?'failed':output?.warnings?.length?'partial':'succeeded',effects:async tx=>{
   const current=(await tx.query('SELECT * FROM source_connections WHERE id=$1 FOR UPDATE',[c.id])).rows[0];
   if(current.version!==run.connection_version){await tx.query("UPDATE collection_runs SET state='cancelled',error_code='CONNECTION_CHANGED',finished_at=now() WHERE id=$1",[run.id]);return;}
   if(output&&this.saveItems)await this.saveItems(tx,current,run.id,output);
   await tx.query(`UPDATE collection_runs SET state=$1,item_count=$2,error_code=$3,coverage=$4,warnings=$5,adapter_version=$6,finished_at=now() WHERE id=$7`,[failure?'failed':output?.warnings?.length?'partial':'succeeded',output?.items.length??0,failure,JSON.stringify(output?{...output.coverage,batch_captured_at:output.captured_at??null,next_cursor:output.next_cursor??null,quota_state:output.quota_state??null}:{failure_diagnostics:diagnostics}),output?.warnings??[],output?.adapter_version??null,run.id]);
   if(failure){
    const failures=current.consecutive_failures+1;const immediate=['AUTH_REQUIRED','ACCESS_DENIED','RATE_LIMITED'].includes(failure);
    const health=failure==='AUTH_REQUIRED'?'auth_required':failure==='RATE_LIMITED'?'rate_limited':failures>=3?'unavailable':'degraded';
    await tx.query('UPDATE source_connections SET health=$1,consecutive_failures=$2,paused=$3,error_code=$4,updated_at=now() WHERE id=$5',[health,failures,immediate||failures>=3,failure,c.id]);
    if(immediate||failures>=3)await tx.query(`INSERT INTO notifications(workspace_id,recipient_id,event_key,job_id,title,task_ref) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[c.workspace_id,current.owner_id,'source-paused:'+run.id,job.id,'来源采集已暂停，请检查并验证恢复','source:'+c.id]);
   }else await tx.query(`UPDATE source_connections SET health=CASE WHEN $3 THEN 'degraded' ELSE 'healthy' END,paused=false,consecutive_failures=0,error_code=NULL,last_success_at=now(),capabilities=COALESCE($1,capabilities),updated_at=now() WHERE id=$2`,[output?.capabilities?JSON.stringify(output.capabilities):null,c.id,Boolean(output?.warnings?.length)]);
  }};
 };
 async audit(tx:Tx,a:Actor,action:string,cid:string,details:unknown={}){await tx.query(`INSERT INTO audit_logs(workspace_id,actor_id,actor_type,action,object_type,object_id,details,request_id) VALUES($1,$2,'user',$3,'source_connection',$4,$5,$6)`,[a.workspaceId,a.memberId,action,cid,JSON.stringify(details),a.requestId]);}
}
