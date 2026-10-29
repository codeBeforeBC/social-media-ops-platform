import {z} from 'zod';
import {Database,Tx} from '../../db/src/db';
import {Actor,AppError,parse,uuid,version,id,canonical,authorize} from './protocol';
import {buildDeletionPlan,quoted} from './account-deletion-plan';
import {Storage} from './storage';
import type {JobHandler} from './jobs';
export async function deletionSummary(q:Pick<Database,'query'>|Tx,workspace:string,operationId:string){
 const r=(await q.query(`SELECT d.id,d.workspace_id,d.account_id,a.name account_name,d.state,d.phase,d.counts,d.error_code,d.created_at,d.updated_at,d.finished_at,d.backup_key IS NOT NULL backup_available,j.state job_state,j.attempts
 FROM account_deletions d LEFT JOIN accounts a ON a.id=d.account_id AND a.workspace_id=d.workspace_id LEFT JOIN jobs j ON j.id=d.job_id AND j.workspace_id=d.workspace_id WHERE d.workspace_id=$1 AND d.id=$2`,[workspace,operationId])).rows[0];
 if(!r)throw new AppError(404,'NOT_FOUND','删除操作不存在或不可见');
 if(['failed','cancelled'].includes(r.job_state)&&r.state!=='completed'){r.state='failed';r.error_code=r.error_code??'DELETION_JOB_FAILED';}return r;
}
export class AccountDeletions{
 constructor(readonly db:Database){}
 async account(q:Pick<Database,'query'>|Tx,a:Actor,accountId:string,lock=false){authorize(a,'admin');parse(uuid,accountId);const r=(await q.query(`SELECT * FROM accounts WHERE workspace_id=$1 AND id=$2 ${lock?'FOR UPDATE':''}`,[a.workspaceId,accountId])).rows[0];if(!r)throw new AppError(404,'NOT_FOUND','账号不存在或不可见');return r;}
 async impact(a:Actor,accountId:string){const ac=await this.account(this.db,a,accountId);if(ac.deletion_operation_id)return {account_id:ac.id,expected_version:ac.version,operation:await deletionSummary(this.db,a.workspaceId,ac.deletion_operation_id)};
  const plan=await buildDeletionPlan(this.db,a.workspaceId,ac.id);return {account_id:ac.id,expected_version:ac.version,fingerprint:plan.fingerprint,counts:plan.counts,file_count:new Set(plan.files.map(f=>f.key)).size,retained_shared_files:plan.retained_shared_files,shared_data_preserved:true};}
 async request(tx:Tx,a:Actor,accountId:string,input:unknown){
  const b=parse(z.object({expected_version:version,confirmed:z.literal(true),force:z.literal(true),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),input);const ac=await this.account(tx,a,accountId,true);
  if(ac.deletion_operation_id)return {status:202,data:{operation:await deletionSummary(tx,a.workspaceId,ac.deletion_operation_id),reused:true}};
  if(ac.version!==b.expected_version)throw new AppError(409,'VERSION_CONFLICT','账号已修改，请重新读取删除影响后确认');
  const plan=await buildDeletionPlan(tx,a.workspaceId,accountId);if(plan.fingerprint!==b.fingerprint)throw new AppError(409,'DELETION_PLAN_CHANGED','关联数据已变化，请刷新影响范围后重新确认');
  const op=id();await tx.query('INSERT INTO account_deletions(id,workspace_id,account_id,requested_by,request_id,counts) VALUES($1,$2,$3,$4,$5,$6)',[op,a.workspaceId,accountId,a.memberId,a.requestId,JSON.stringify(plan.counts)]);
  await tx.query("SELECT set_config('yoyo.account_deletion',$1,true)",[op]);
  await tx.query('UPDATE accounts SET deletion_operation_id=$2,version=version+1,updated_at=now() WHERE id=$1',[accountId,op]);
  await tx.query("UPDATE outbox SET retired_at=COALESCE(retired_at,now()),dispatched_at=COALESCE(dispatched_at,now()),retirement_reason='account deletion' WHERE workspace_id=$1 AND account_id=$2",[a.workspaceId,accountId]);
  await tx.query("UPDATE jobs SET state='cancelled',cancel_requested=true,error_code='ACCOUNT_DELETING',finished_at=now(),lease_token=NULL,lease_until=NULL,version=version+1,execution_finished_at=CASE WHEN started_at IS NULL THEN now() ELSE execution_finished_at END WHERE workspace_id=$1 AND account_id=$2 AND state IN('queued','running')",[a.workspaceId,accountId]);
  const out=(await tx.query("INSERT INTO outbox(workspace_id,event_key,event_type,payload) VALUES($1,$2,'account.delete',$3) RETURNING id",[a.workspaceId,'account.delete:'+op,JSON.stringify({pool:'general',created_by:a.memberId,request_id:a.requestId,input:{deletion_id:op}})])).rows[0];
  const job=(await tx.query("INSERT INTO jobs(workspace_id,created_by,outbox_id,type,pool,input,request_id,timeout_seconds,max_attempts) VALUES($1,$2,$3,'account.delete','general',$4,$5,1800,3) RETURNING id",[a.workspaceId,a.memberId,out.id,JSON.stringify({deletion_id:op}),a.requestId])).rows[0];
  await tx.query('UPDATE account_deletions SET job_id=$2 WHERE id=$1',[op,job.id]);
  await tx.query("INSERT INTO audit_logs(workspace_id,actor_id,actor_type,action,object_type,object_id,details,request_id) VALUES($1,$2,'user','account.force_delete.accepted','account_deletion',$3,$4,$5)",[a.workspaceId,a.memberId,op,JSON.stringify({counts:plan.counts}),a.requestId]);return {status:202,data:{operation:await deletionSummary(tx,a.workspaceId,op),reused:false}};
 }
 async get(a:Actor,op:string){authorize(a,'admin');parse(uuid,op);return deletionSummary(this.db,a.workspaceId,op);}
 async list(a:Actor){authorize(a,'admin');const ids=(await this.db.query('SELECT id FROM account_deletions WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20',[a.workspaceId])).rows;return {items:await Promise.all(ids.map(r=>deletionSummary(this.db,a.workspaceId,r.id)))};}
 async retry(tx:Tx,a:Actor,op:string){authorize(a,'admin');parse(uuid,op);const r=(await tx.query('SELECT * FROM account_deletions WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[op,a.workspaceId])).rows[0];if(!r)throw new AppError(404,'NOT_FOUND','删除操作不可见');if(r.state==='completed')return {status:200,data:await deletionSummary(tx,a.workspaceId,op)};
  const j=(await tx.query('SELECT state FROM jobs WHERE id=$1 FOR UPDATE',[r.job_id])).rows[0];if(j&&['queued','running'].includes(j.state))return {status:200,data:await deletionSummary(tx,a.workspaceId,op)};
  await tx.query("UPDATE jobs SET state='queued',attempts=0,cancel_requested=false,error_code=NULL,result=NULL,available_at=now(),started_at=NULL,finished_at=NULL,execution_finished_at=NULL,lease_token=NULL,lease_until=NULL WHERE id=$1",[r.job_id]);await tx.query('UPDATE account_deletions SET state=phase,error_code=NULL,updated_at=now() WHERE id=$1',[op]);return {status:200,data:await deletionSummary(tx,a.workspaceId,op)};
 }
}
type DeleteStore=Pick<Storage,'get'|'put'|'putStream'|'abort'|'remove'|'destroy'|'list'>;
export class AccountDeletionTasks{
 constructor(readonly db:Database,readonly storeFactory:()=>DeleteStore=()=>new Storage()){}
 handler:JobHandler=async(job,signal)=>{
  const opId=parse(uuid,job.input.deletion_id),lock=await this.db.pool.connect();let store:DeleteStore|undefined,held=false;
  const assertOwner=async()=>{if(signal.aborted)throw Error('DELETION_INTERRUPTED');const live=await this.db.query("SELECT 1 FROM jobs WHERE id=$1 AND lease_token=$2 AND lease_until>now() AND state='running' AND NOT cancel_requested",[job.id,job.lease_token]);if(!live.rowCount)throw Error('DELETION_INTERRUPTED');};
  const progress=async(state:string)=>{await assertOwner();await this.db.query('UPDATE account_deletions SET state=$2,phase=$2,error_code=NULL,updated_at=now() WHERE id=$1',[opId,state]);};
  try{
   held=(await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,25)) held',[opId])).rows[0].held;if(!held)throw Error('DELETION_ALREADY_RUNNING');
   let op=(await this.db.query('SELECT * FROM account_deletions WHERE id=$1 AND workspace_id=$2 AND job_id=$3',[opId,job.workspace_id,job.id])).rows[0];if(!op)throw Error('DELETION_MISSING');if(op.state==='completed')return {result:{deletion_id:opId,completed:true}};
   await assertOwner();store=this.storeFactory();
   if(!['cleaning_files','completed'].includes(op.phase)){
    await progress('stopping');
    for(;;){await assertOwner();const pending=await this.db.query("SELECT 1 FROM jobs WHERE workspace_id=$1 AND account_id=$2 AND started_at IS NOT NULL AND execution_finished_at IS NULL AND started_at+(timeout_seconds+30)*interval '1 second'>now() LIMIT 1",[op.workspace_id,op.account_id]);if(!pending.rowCount)break;await new Promise(r=>setTimeout(r,200));}
    await progress('backing_up');const plan=await buildDeletionPlan(this.db,op.workspace_id,op.account_id,opId);
    const files=[...plan.files];
    // A crashed preview worker can leave objects/parts before committing file_objects.
    for(const row of plan.rows.filter(r=>r.table==='file_objects'&&!r.data.is_preview)){
     await assertOwner();const inventory=await store.list(`${op.workspace_id}/previews/${row.data.id}/`);
     for(const entry of [...inventory.objects.map(key=>({key,ready:true,upload_id:undefined})),...inventory.uploads.map(u=>({...u,ready:false}))]){
      if(files.some(f=>f.key===entry.key&&f.upload_id===entry.upload_id))continue;
      const refs=(await this.db.query('SELECT id FROM file_objects WHERE object_key=$1',[entry.key])).rows;
      files.push({...entry,remove:!refs.some(r=>!plan.rows.some(d=>d.table==='file_objects'&&d.data.id===r.id))});
     }
    }
    if(files.length>plan.files.length)plan.counts['残留文件或分片']=files.length-plan.files.length;
    const prefix=`${op.workspace_id}/account-deletion-backups/${opId}`;
    const manifest:any[]=[];for(const [index,file] of files.entries()){
     await assertOwner();try{const source=await store.get(file.key);const key=prefix+'/objects/'+index;const copied=await store.putStream(key,source.Body as any,'application/octet-stream');const expected=plan.rows.find(r=>r.table==='file_objects'&&r.data.object_key===file.key)?.data;if(expected&&(copied.sha256!==expected.sha256||copied.size_bytes!==Number(expected.size_bytes)))throw Error('DELETION_BACKUP_FAILED');manifest.push({...file,backup_key:key,...copied});}
     catch(e){if(!file.ready&&['NoSuchKey','NotFound'].includes((e as any).name))manifest.push({...file,backup_missing_unfinished:true});else throw Error('DELETION_BACKUP_FAILED');}
    }
    const backup=prefix+'/records.json';await store.put(backup,Buffer.from(JSON.stringify({format:'account-delete-v1',created_at:new Date().toISOString(),account_id:op.account_id,rows:plan.rows,detaches:plan.detaches,files:manifest})), 'application/json');
    await this.db.query('UPDATE account_deletions SET backup_key=$2,files=$3,counts=$4,updated_at=now() WHERE id=$1',[opId,backup,JSON.stringify(files),JSON.stringify(plan.counts)]);
    await assertOwner();await this.db.transaction(async tx=>{
     await tx.query('SELECT * FROM accounts WHERE id=$1 AND workspace_id=$2 AND deletion_operation_id=$3 FOR UPDATE',[op.account_id,op.workspace_id,opId]);
     await tx.query("SELECT set_config('yoyo.account_deletion',$1,true)",[opId]);await tx.query("UPDATE account_deletions SET state='purging',phase='purging',updated_at=now() WHERE id=$1",[opId]);
     await tx.query('SET CONSTRAINTS ALL DEFERRED');
     const latest=await buildDeletionPlan(tx,op.workspace_id,op.account_id,opId);if(latest.fingerprint!==plan.fingerprint)throw Error('DELETION_PLAN_CHANGED');
     await tx.query('CREATE TEMP TABLE account_purge_rows(operation_id uuid,schema_name text,table_name text,row_key jsonb) ON COMMIT DROP');
     for(const row of latest.rows)await tx.query('INSERT INTO account_purge_rows VALUES($1,$2,$3,$4)',[opId,row.schema,row.table,JSON.stringify(row.key)]);
     for(const row of latest.detaches)await tx.query('UPDATE ai_runs SET job_id=NULL WHERE id=$1 AND workspace_id=$2',[row.data.id,op.workspace_id]);
     for(const row of latest.rows.filter(r=>r.schema==='public'&&r.table==='ai_attempts')){
      const d=row.data;await tx.query('INSERT INTO account_deleted_ai_usage(id,workspace_id,deletion_id,started_at,currency,cost_basis,estimated_cost,reserved_cost,usage) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING',[d.id,d.workspace_id,opId,d.started_at,d.currency,d.cost_basis,d.estimated_cost,d.reserved_cost,JSON.stringify(d.usage)]);
     }
     for(const row of [...latest.rows.filter(r=>r.table!=='accounts'),...latest.rows.filter(r=>r.table==='accounts')]){
      const keys=Object.keys(row.key);
      if(row.schema==='public'&&row.table==='idempotency_records'){await tx.query(`UPDATE idempotency_records SET response=$${keys.length+1}::jsonb,status=404 WHERE ${keys.map((c,i)=>quoted(c)+'=$'+(i+1)).join(' AND ')}`,[...keys.map(k=>row.key[k]),JSON.stringify({deleted_account_operation:opId})]);continue;}
      await tx.query(`DELETE FROM ${quoted(row.schema)}.${quoted(row.table)} WHERE ${keys.map((c,i)=>quoted(c)+'=$'+(i+1)).join(' AND ')}`,keys.map(k=>row.key[k]));
     }
     await assertOwner();await tx.query("UPDATE account_deletions SET state='cleaning_files',phase='cleaning_files',updated_at=now() WHERE id=$1",[opId]);
    });op=(await this.db.query('SELECT * FROM account_deletions WHERE id=$1',[opId])).rows[0];
   }
   await progress('cleaning_files');for(const file of op.files){await assertOwner();try{if(file.upload_id)await store.abort(file.key,file.upload_id);if(file.remove!==false)await store.remove(file.key);}catch{throw Error('DELETION_FILE_CLEANUP_FAILED');}}
   await assertOwner();await this.db.transaction(async tx=>{
    await tx.query("UPDATE account_deletions SET state='completed',phase='completed',error_code=NULL,files='[]',finished_at=now(),updated_at=now() WHERE id=$1",[opId]);
    await tx.query("INSERT INTO audit_logs(workspace_id,actor_type,action,object_type,object_id,details,request_id) VALUES($1,'service','account.force_delete.completed','account_deletion',$2,$3,$4)",[op.workspace_id,opId,JSON.stringify({counts:op.counts,backup_available:true}),job.request_id]);
   });return {result:{deletion_id:opId,completed:true}};
  }catch(e){
   const code=['DELETION_BACKUP_FAILED','DELETION_FILE_CLEANUP_FAILED','DELETION_PLAN_CHANGED','DELETION_SHARED_REFERENCE'].includes((e as any).code??(e as Error).message)?(e as any).code??(e as Error).message:'ACCOUNT_DELETE_FAILED';
   await this.db.query("UPDATE account_deletions SET state='failed',error_code=$2,updated_at=now() WHERE id=$1 AND EXISTS(SELECT 1 FROM jobs WHERE id=$3 AND lease_token=$4 AND lease_until>now())",[opId,code,job.id,job.lease_token]);throw e;
  }finally{store?.destroy();try{if(held)await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,25))',[opId]);}finally{lock.release();}}
 };
}
