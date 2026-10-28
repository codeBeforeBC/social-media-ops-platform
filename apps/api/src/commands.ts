import {z} from 'zod';
import {Database,Tx} from '../../../packages/db/src/db';
import {AppError,Actor,Permission,authorize,canonical,sha,parse,text,uuid,version,timezone,pagination,page} from '../../../packages/domain/src/protocol';
import {reloadActor} from '../../../packages/domain/src/instance';
import {storeResponse,readResponse} from '../../../packages/domain/src/response-storage';
import {loadAIConfig,workspaceBudgetSchema,workspaceAIConfig,AIFailure} from '../../../packages/domain/src/ai-gateway';
import {sourceOrganizationCurrent} from '../../../packages/domain/src/source-organization';
import {config} from '../../../packages/domain/src/config';
import {profileRef} from '../../../packages/domain/src/account-verifications';
import {xhsAccountIdentity} from '../../../packages/domain/src/xhs-account';
export type Result={status:number;data:unknown};
export async function audit(tx:Tx,a:Actor,action:string,objectType:string,objectId:string,details:unknown={}){
  await tx.query(`INSERT INTO audit_logs(workspace_id,actor_id,actor_type,action,object_type,object_id,details,request_id) VALUES($1,$2,'user',$3,$4,$5,$6,$7)`,[a.workspaceId,a.memberId,action,objectType,objectId,JSON.stringify(details),a.requestId]);
}
export class Commands {
  constructor(readonly db:Database){}
  async command(a:Actor,key:unknown,method:string,route:string,input:unknown,permission:Permission,fn:(tx:Tx,actor:Actor)=>Promise<Result>){
    const k=parse(text(200),key);const fingerprint=sha(canonical(input));
    return this.db.transaction(async tx=>{
      const actor=await reloadActor(tx,a);authorize(actor,permission);
      route=route+'@v1.2';
      const lock=canonical([a.workspaceId,a.memberId,method,route,k]);
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[lock]);
      const r=await tx.query('SELECT request_hash,status,response FROM idempotency_records WHERE workspace_id=$1 AND actor_id=$2 AND method=$3 AND route=$4 AND key=$5',[a.workspaceId,a.memberId,method,route,k]);
      if(r.rowCount){if(r.rows[0].request_hash!==fingerprint)throw new AppError(409,'IDEMPOTENCY_CONFLICT','相同请求键对应不同内容');let cached:any=readResponse(r.rows[0].response);
        if(route.startsWith('/accounts')&&cached?.verification?.id){
          await this.accountScope(tx,actor,cached.verification.account_id);
          const now=(await tx.query('SELECT v.*,j.state,j.started_at,j.finished_at,j.error_code FROM account_verifications v JOIN jobs j ON j.id=v.job_id AND j.workspace_id=v.workspace_id WHERE v.id=$1 AND v.workspace_id=$2',[cached.verification.id,a.workspaceId])).rows[0];
          if(!now)throw new AppError(404,'NOT_FOUND','验证记录不存在或不可见');cached={verification:now,reused:true};
        }else if(route.startsWith('/accounts')&&cached?.id){cached=await this.accountScope(tx,actor,cached.id);}
        // Consent and evidence may be revoked after a successful write; replay must reflect current permissions and state.
        const table=cached?.id&&(route.startsWith('/source-organizations/')?'source_organizations':route.startsWith('/feedback')?'feedback':route.startsWith('/strategy-memories/')?'strategy_memories':route.startsWith('/reports/')?'reports':null);
        if(table){const current=(await tx.query(`SELECT * FROM ${table} WHERE workspace_id=$1 AND id=$2`,[a.workspaceId,cached.id])).rows[0];if(!current)throw new AppError(404,'NOT_FOUND','对象不存在或不可见');await this.accountScope(tx,actor,current.account_id);cached=current;if(table==='source_organizations')cached.current=await sourceOrganizationCurrent(tx,cached);if(table==='reports')cached.strategies=(await tx.query('SELECT * FROM strategy_memories WHERE report_id=$1 ORDER BY action_index',[cached.id])).rows;}
        return {status:r.rows[0].status,data:cached};}
      const result=await fn(tx,actor);
      await tx.query('INSERT INTO idempotency_records(workspace_id,actor_id,method,route,key,request_hash,status,response) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[a.workspaceId,a.memberId,method,route,k,fingerprint,result.status,JSON.stringify(storeResponse(result.data))]);
      return result;
    });
  }
  async accountScope(query:Pick<Database,'query'>|Tx,a:Actor,accountId:string,lock=false){
    parse(uuid,accountId);
    const r=await query.query(`SELECT ac.* FROM accounts ac WHERE ac.id=$1 AND ac.workspace_id=$2 AND ($3::boolean OR EXISTS(SELECT 1 FROM account_memberships am WHERE am.account_id=ac.id AND am.membership_id=$4)) ${lock?'FOR UPDATE OF ac':''}`,[accountId,a.workspaceId,a.roles.includes('admin'),a.memberId]);
    if(!r.rowCount)throw new AppError(404,'NOT_FOUND','账号不存在或不可见');return r.rows[0];
  }
  async accounts(a:Actor){const r=await this.db.query('SELECT * FROM accounts ac WHERE workspace_id=$1 AND ($2::boolean OR EXISTS(SELECT 1 FROM account_memberships am WHERE am.account_id=ac.id AND am.membership_id=$3)) ORDER BY created_at,id',[a.workspaceId,a.roles.includes('admin'),a.memberId]);return {items:r.rows};}
  async createAccount(tx:Tx,a:Actor,input:unknown){
    const b=parse(z.object({platform:z.literal('xiaohongshu'),platform_user_id:text(2000),display_handle:text().optional(),name:text(),timezone:timezone.optional(),browser_profile_ref:profileRef.nullable().optional()}).strict(),input);
    const identity=xhsAccountIdentity(b.platform_user_id);
    if(!identity)throw new AppError(422,'INVALID_ACCOUNT_ID','请输入24位小红书内部账号ID或完整官方主页链接；昵称、小红书号和笔记链接不能代替内部ID');
    const legacy=(await tx.query('SELECT id,platform_user_id FROM accounts WHERE workspace_id=$1 AND platform=$2 ORDER BY created_at,id',[a.workspaceId,b.platform])).rows.find(row=>xhsAccountIdentity(row.platform_user_id)?.id===identity.id);
    if(legacy)throw new AppError(409,'ACCOUNT_EXISTS','这个小红书账号已经登记，请查看已有账号',{account_id:legacy.id});
    const r=await tx.query('INSERT INTO accounts(workspace_id,platform,platform_user_id,display_handle,name,owner_id,timezone,profile_url,browser_profile_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(workspace_id,platform,platform_user_id) DO NOTHING RETURNING *',[a.workspaceId,b.platform,identity.id,b.display_handle??'',b.name,a.memberId,b.timezone??'Asia/Shanghai',identity.profile_url,b.browser_profile_ref??null]);
    if(!r.rowCount){const existing=(await tx.query('SELECT id FROM accounts WHERE workspace_id=$1 AND platform=$2 AND platform_user_id=$3',[a.workspaceId,b.platform,identity.id])).rows[0];throw new AppError(409,'ACCOUNT_EXISTS','这个小红书账号已经登记，请查看已有账号',{account_id:existing.id});}
    await tx.query('INSERT INTO account_memberships VALUES($1,$2,$3)',[a.workspaceId,r.rows[0].id,a.memberId]);await audit(tx,a,'account.create','account',r.rows[0].id);return {status:201,data:r.rows[0]};
  }
  async patchAccount(tx:Tx,a:Actor,accountId:string,input:unknown){
    const b=parse(z.object({name:text().optional(),timezone:timezone.optional(),browser_profile_ref:profileRef.nullable().optional(),expected_version:version}).strict(),input);
    const ac=await this.accountScope(tx,a,accountId,true);
    if(ac.version!==b.expected_version)throw new AppError(409,'VERSION_CONFLICT','账号已被修改',{version:ac.version});
    const changed=b.browser_profile_ref!==undefined&&b.browser_profile_ref!==ac.browser_profile_ref;
    const r=await tx.query(`UPDATE accounts SET name=COALESCE($1,name),timezone=COALESCE($2,timezone),browser_profile_ref=CASE WHEN $4 THEN $5 ELSE browser_profile_ref END,
      identity_binding_version=identity_binding_version+CASE WHEN $4 THEN 1 ELSE 0 END,
      confirmed_verification_id=CASE WHEN $4 THEN NULL ELSE confirmed_verification_id END,confirmed_at=CASE WHEN $4 THEN NULL ELSE confirmed_at END,
      verification_next_at=CASE WHEN $4 THEN NULL ELSE verification_next_at END,version=version+1,updated_at=now() WHERE id=$3 RETURNING *`,[b.name??null,b.timezone??null,accountId,changed,b.browser_profile_ref??null]);
    await audit(tx,a,'account.update','account',accountId,{fields:Object.keys(b).filter(k=>k!=='expected_version')});return {status:200,data:r.rows[0]};
  }
  async settings(a:Actor){const r=await this.db.query('SELECT id,name,timezone,settings,version FROM workspaces WHERE id=$1',[a.workspaceId]);return r.rows[0];}
  async patchSettings(tx:Tx,a:Actor,input:unknown){
    const b=parse(z.object({category:z.enum(['workspace','capacity','ai_budget']),settings:z.record(z.string(),z.unknown()),expected_version:version}).strict(),input);
    const allowed=b.category==='workspace'?z.object({name:text().optional(),timezone:timezone.optional()}).strict():b.category==='capacity'?z.object({hours_per_week:z.number().min(0).max(168)}).strict():workspaceBudgetSchema;
    const values=parse(allowed as z.ZodType<Record<string,unknown>>,b.settings);
    if(b.category==='ai_budget')try{workspaceAIConfig(loadAIConfig(),{ai_budget:values});}catch(e){throw new AppError(422,e instanceof AIFailure?e.code:'AI_CONFIG_INVALID','预算需完整配置，有限预算需可核对单价及币种');}
    const old=await tx.query('SELECT version FROM workspaces WHERE id=$1 FOR UPDATE',[a.workspaceId]);
    if(old.rows[0].version!==b.expected_version)throw new AppError(409,'VERSION_CONFLICT','设置已被其他人修改',{version:old.rows[0].version});
    const r=await tx.query('UPDATE workspaces SET name=COALESCE($1,name),timezone=COALESCE($2,timezone),settings=jsonb_set(settings,ARRAY[$3],$4::jsonb),version=version+1,updated_at=now() WHERE id=$5 RETURNING id,name,timezone,settings,version',[values.name??null,values.timezone??null,b.category,JSON.stringify(values),a.workspaceId]);
    await audit(tx,a,'settings.update','workspace',a.workspaceId,{category:b.category});return {status:200,data:r.rows[0]};
  }
  async logs(a:Actor,q:Record<string,unknown>){
    authorize(a,'admin');const {limit,cursor}=pagination(q);
    const start=q.start?parse(z.iso.datetime({offset:true}),q.start):null;const end=q.end?parse(z.iso.datetime({offset:true}),q.end):null;
    const r=await this.db.query(`SELECT * FROM audit_logs WHERE workspace_id=$1 AND ($2::timestamptz IS NULL OR (occurred_at,id)<($2,$3::uuid)) AND ($4::timestamptz IS NULL OR occurred_at>=$4) AND ($5::timestamptz IS NULL OR occurred_at<$5) ORDER BY occurred_at DESC,id DESC LIMIT $6`,[a.workspaceId,cursor?.at??null,cursor?.id??null,start,end,limit+1]);return page(r.rows,limit,'occurred_at');
  }
  async notifications(a:Actor,q:Record<string,unknown>){
    const {limit,cursor}=pagination(q);if(q.unread!==undefined&&!['true','false'].includes(String(q.unread)))throw new AppError(422,'VALIDATION_ERROR','unread应为true/false');
    const r=await this.db.query(`SELECT * FROM (SELECT DISTINCT ON(event_key,channel) * FROM notifications WHERE workspace_id=$1 ORDER BY event_key,channel,(read_at IS NOT NULL),created_at,id) n WHERE ($2::timestamptz IS NULL OR (created_at,id)<($2,$3::uuid)) AND ($4::boolean IS NOT TRUE OR (read_at IS NULL AND superseded_at IS NULL)) ORDER BY created_at DESC,id DESC LIMIT $5`,[a.workspaceId,cursor?.at??null,cursor?.id??null,q.unread==='true',limit+1]);return page(r.rows,limit);
  }
  async readNotification(tx:Tx,a:Actor,notificationId:string){
    parse(uuid,notificationId);const r=await tx.query('UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE workspace_id=$1 AND (event_key,channel)=(SELECT event_key,channel FROM notifications WHERE workspace_id=$1 AND id=$2) RETURNING *',[a.workspaceId,notificationId]);
    if(!r.rowCount)throw new AppError(404,'NOT_FOUND','通知不存在或不可见');await audit(tx,a,'notification.read','notification',notificationId);return {status:200,data:r.rows.find(n=>n.id===notificationId)??r.rows[0]};
  }

  async jobScope(query:Pick<Database,'query'>|Tx,a:Actor,jobId:string,lock=false){
    parse(uuid,jobId);const r=await query.query(`SELECT * FROM jobs WHERE yoyo_job_supported(type,pool,input) AND id=$1 AND workspace_id=$2 AND ($3::boolean OR created_by=$4) ${lock?'FOR UPDATE':''}`,[jobId,a.workspaceId,a.roles.includes('admin'),a.memberId]);
    if(!r.rowCount)throw new AppError(404,'NOT_FOUND','任务不存在或不可见');
    if(r.rows[0].account_id)await this.accountScope(query,a,r.rows[0].account_id);return r.rows[0];
  }
  async jobs(a:Actor,q:Record<string,unknown>){
    const state=q.state===undefined?null:parse(z.enum(['queued','running','succeeded','partial','failed','cancelled']),q.state);
    const {limit,cursor}=pagination(q);const r=await this.db.query(`SELECT j.* FROM jobs j WHERE ($7::text IS NULL OR state=$7) AND yoyo_job_supported(type,pool,input) AND workspace_id=$1 AND ($2::boolean OR created_by=$3) AND ($4::timestamptz IS NULL OR (created_at,id)<($4,$5::uuid)) AND (account_id IS NULL OR $2::boolean OR EXISTS(SELECT 1 FROM account_memberships am WHERE am.account_id=j.account_id AND am.membership_id=$3)) ORDER BY created_at DESC,id DESC LIMIT $6`,[a.workspaceId,a.roles.includes('admin'),a.memberId,cursor?.at??null,cursor?.id??null,limit+1,state]);return page(r.rows.map(safeJob),limit);
  }
  async diagnostic(tx:Tx,a:Actor,input:unknown){
    const b=parse(z.object({pool:z.enum(['general']),account_id:uuid.optional()}).strict(),input);
    if(b.account_id)await this.accountScope(tx,a,b.account_id);
    const w=await tx.query('SELECT version FROM workspaces WHERE id=$1 FOR SHARE',[a.workspaceId]);
    const out=await tx.query(`INSERT INTO outbox(workspace_id,account_id,event_key,event_type,payload) VALUES($1,$2,$3,'system.check',$4) RETURNING id`,[a.workspaceId,b.account_id??null,a.requestId,JSON.stringify({pool:b.pool,created_by:a.memberId,input_version:w.rows[0].version,request_id:a.requestId})]);
    const job=await tx.query(`INSERT INTO jobs(workspace_id,account_id,created_by,outbox_id,type,pool,input_version,request_id) VALUES($1,$2,$3,$4,'system.check',$5,$6,$7) RETURNING id`,[a.workspaceId,b.account_id??null,a.memberId,out.rows[0].id,b.pool,w.rows[0].version,a.requestId]);
    await audit(tx,a,'diagnostic.enqueue','outbox',out.rows[0].id);return {status:202,data:{event_id:out.rows[0].id,job_id:job.rows[0].id,status_url:config.origin+'/api/v1/jobs/'+job.rows[0].id,state:'queued'}};
  }
  async cancelJob(tx:Tx,a:Actor,jobId:string,input:unknown){
    const b=parse(z.object({reason:text(1000)}).strict(),input);const j=await this.jobScope(tx,a,jobId,true);
    if(['succeeded','partial','failed','cancelled'].includes(j.state))return {status:200,data:safeJob(j)};
    const r=await tx.query("UPDATE jobs SET cancel_requested=true,state='cancelled',finished_at=now(),lease_token=NULL,lease_until=NULL,error_code='CANCELLED',version=version+1 WHERE id=$1 RETURNING *",[jobId]);
    await audit(tx,a,'job.cancel','job',jobId,{reason:b.reason});return {status:200,data:safeJob(r.rows[0])};
  }
  async retryJob(tx:Tx,a:Actor,jobId:string,input:unknown){
    parse(z.object({reason:text(1000)}).strict(),input);const j=await this.jobScope(tx,a,jobId,true);
    if(j.state!=='failed')throw new AppError(422,'JOB_NOT_FAILED','仅失败任务允许重试');
    if(j.type==='account.verify')throw new AppError(422,'ACCOUNT_VERIFICATION_RETRY_REQUIRED','请在运营账号详情重新验证，保留原验证历史');
    const r=await tx.query("UPDATE jobs SET state='queued',attempts=0,cancel_requested=false,error_code=NULL,result=NULL,available_at=now(),started_at=NULL,finished_at=NULL,lease_token=NULL,lease_until=NULL,version=version+1 WHERE id=$1 RETURNING *",[jobId]);
    await audit(tx,a,'job.retry','job',jobId);return {status:202,data:safeJob(r.rows[0])};
  }
  async monitor(a:Actor){
    authorize(a,'admin');const jobs=await this.db.query("SELECT pool,state,count(*)::int count,min(created_at) oldest FROM jobs WHERE yoyo_job_supported(type,pool,input) AND workspace_id=$1 GROUP BY pool,state ORDER BY pool,state",[a.workspaceId]);
    const processes=await this.db.query("SELECT name,pool,last_seen_at,(last_seen_at>now()-interval '15 seconds') healthy FROM process_health WHERE pool<>'reminder' ORDER BY name");
    const outbox=await this.db.query('SELECT count(*)::int pending FROM outbox WHERE workspace_id=$1 AND dispatched_at IS NULL',[a.workspaceId]);
    const workspace=(await this.db.query('SELECT settings FROM workspaces WHERE id=$1',[a.workspaceId])).rows[0];let ai:any;try{const cfg=workspaceAIConfig(loadAIConfig(),workspace.settings);ai={state:cfg.enabled?'enabled':'disabled',provider:cfg.provider,model:cfg.model,budget:cfg.budget,pricing:cfg.pricing??null,authorization_date:cfg.authorization_date};}catch(e){ai={state:'unavailable',error_code:e instanceof AIFailure?e.code:'AI_NOT_CONFIGURED'};}
    const usage=await this.db.query("SELECT currency,cost_basis,count(*)::int attempts,sum((usage->>'input_tokens')::bigint)::text input_tokens,sum((usage->>'output_tokens')::bigint)::text output_tokens,sum((usage->>'total_tokens')::bigint)::text total_tokens,CASE WHEN count(*) FILTER(WHERE estimated_cost IS NULL)=0 THEN sum(estimated_cost)::text ELSE NULL END estimated_cost,sum(COALESCE(estimated_cost,reserved_cost))::text committed_or_reserved,count(*) FILTER(WHERE usage IS NULL OR usage='null'::jsonb)::int unknown_usage FROM ai_attempts WHERE workspace_id=$1 AND started_at>=(now() AT TIME ZONE 'UTC')::date AT TIME ZONE 'UTC' GROUP BY currency,cost_basis ORDER BY currency,cost_basis",[a.workspaceId]);
    const sources=await this.db.query('SELECT id,name,health,enabled,paused,error_code,last_success_at,min_interval_seconds,schedule,timezone,version FROM source_connections WHERE workspace_id=$1 ORDER BY created_at,id',[a.workspaceId]);
    return {as_of:new Date().toISOString(),jobs:jobs.rows,processes:processes.rows,outbox_pending:outbox.rows[0].pending,external_capabilities:{ai,ocr:{state:'local_manual_review',runtime_state:'unverified'},sources:sources.rows},ai_usage:{window:'UTC current day',groups:usage.rows},import_limits:{screenshot_bytes:20*1024*1024,table_bytes:50*1024*1024}};
  }
}
export function safeJob(j:Record<string,any>){const {lease_token,input,...safe}=j;return safe;}
