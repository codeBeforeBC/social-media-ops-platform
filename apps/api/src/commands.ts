import {z} from 'zod';
import {Database,Tx} from '../../../packages/db/src/db';
import {AppError,Actor,Permission,authorize,canonical,sha,parse,text,uuid,roles,version,timezone,pagination,page,secret} from '../../../packages/domain/src/protocol';
import {reloadActor,passwordHash} from './auth';
import {storeResponse,readResponse} from '../../../packages/domain/src/response-storage';
import {config} from '../../../packages/domain/src/config';
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
      if(r.rowCount){if(r.rows[0].request_hash!==fingerprint)throw new AppError(409,'IDEMPOTENCY_CONFLICT','相同请求键对应不同内容');return {status:r.rows[0].status,data:readResponse(r.rows[0].response)};}
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
    const b=parse(z.object({platform:z.enum(['xiaohongshu','weibo']),platform_user_id:text(),display_handle:text().optional(),name:text(),timezone:timezone.optional()}).strict(),input);
    const r=await tx.query('INSERT INTO accounts(workspace_id,platform,platform_user_id,display_handle,name,owner_id,timezone) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[a.workspaceId,b.platform,b.platform_user_id,b.display_handle??'',b.name,a.memberId,b.timezone??'Asia/Shanghai']);
    await tx.query('INSERT INTO account_memberships VALUES($1,$2,$3)',[a.workspaceId,r.rows[0].id,a.memberId]);await audit(tx,a,'account.create','account',r.rows[0].id);return {status:201,data:r.rows[0]};
  }
  async patchAccount(tx:Tx,a:Actor,accountId:string,input:unknown){
    const b=parse(z.object({name:text().optional(),owner_id:uuid.optional(),timezone:timezone.optional(),expected_version:version}).strict(),input);
    const ac=await this.accountScope(tx,a,accountId,true);
    if(b.owner_id&&!a.roles.includes('admin'))throw new AppError(403,'FIELD_FORBIDDEN','仅管理员可以更换负责人');
    if(ac.version!==b.expected_version)throw new AppError(409,'VERSION_CONFLICT','账号已被其他人修改',{version:ac.version});
    if(b.owner_id){
      const m=await tx.query('SELECT id FROM memberships WHERE id=$1 AND workspace_id=$2 AND active FOR SHARE',[b.owner_id,a.workspaceId]);
      if(!m.rowCount)throw new AppError(422,'OWNER_INVALID','负责人必须是本工作区的有效成员');
      await tx.query('INSERT INTO account_memberships VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[a.workspaceId,accountId,b.owner_id]);
    }
    const r=await tx.query('UPDATE accounts SET name=COALESCE($1,name),owner_id=COALESCE($2,owner_id),timezone=COALESCE($3,timezone),version=version+1,updated_at=now() WHERE id=$4 RETURNING *',[b.name??null,b.owner_id??null,b.timezone??null,accountId]);
    await audit(tx,a,'account.update','account',accountId,{fields:Object.keys(b).filter(k=>k!=='expected_version')});return {status:200,data:r.rows[0]};
  }
  async settings(a:Actor){const r=await this.db.query('SELECT id,name,timezone,settings,version FROM workspaces WHERE id=$1',[a.workspaceId]);return r.rows[0];}
  async patchSettings(tx:Tx,a:Actor,input:unknown){
    const b=parse(z.object({category:z.enum(['workspace','capacity']),settings:z.record(z.string(),z.unknown()),expected_version:version}).strict(),input);
    const allowed=b.category==='workspace'?z.object({name:text().optional(),timezone:timezone.optional()}).strict():z.object({hours_per_week:z.number().min(0).max(168)}).strict();
    const values=parse(allowed as z.ZodType<Record<string,unknown>>,b.settings);
    const old=await tx.query('SELECT version FROM workspaces WHERE id=$1 FOR UPDATE',[a.workspaceId]);
    if(old.rows[0].version!==b.expected_version)throw new AppError(409,'VERSION_CONFLICT','设置已被其他人修改',{version:old.rows[0].version});
    const r=await tx.query('UPDATE workspaces SET name=COALESCE($1,name),timezone=COALESCE($2,timezone),settings=jsonb_set(settings,ARRAY[$3],$4::jsonb),version=version+1,updated_at=now() WHERE id=$5 RETURNING id,name,timezone,settings,version',[values.name??null,values.timezone??null,b.category,JSON.stringify(values),a.workspaceId]);
    await audit(tx,a,'settings.update','workspace',a.workspaceId,{category:b.category});return {status:200,data:r.rows[0]};
  }
  async members(a:Actor,q:Record<string,unknown>){
    authorize(a,'admin');const {limit,cursor}=pagination(q);
    const r=await this.db.query(`SELECT m.*,u.email,u.display_name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND ($2::timestamptz IS NULL OR (m.created_at,m.id)<($2,$3::uuid)) ORDER BY m.created_at DESC,m.id DESC LIMIT $4`,[a.workspaceId,cursor?.at??null,cursor?.id??null,limit+1]);return page(r.rows,limit);
  }
  async createMember(tx:Tx,a:Actor,input:unknown){
    const b=parse(z.object({email:z.email().max(254).transform(s=>s.toLowerCase()),display_name:text().optional(),roles}).strict(),input);
    const token=secret();const pw=await passwordHash(secret());
    // 已有身份不得被邀请流程改写密码；跨工作区复用身份须另行实现邀请确认。
    const r=await tx.query('INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id',[b.email,b.display_name??b.email,pw]);
    if(!r.rowCount)throw new AppError(409,'MEMBER_EXISTS','该身份已存在');
    const m=await tx.query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3) RETURNING *',[a.workspaceId,r.rows[0].id,b.roles]);
    const accountRows=await tx.query('SELECT id FROM accounts WHERE workspace_id=$1',[a.workspaceId]);
    for(const ac of accountRows.rows)await tx.query('INSERT INTO account_memberships VALUES($1,$2,$3)',[a.workspaceId,ac.id,m.rows[0].id]);
    await tx.query("INSERT INTO invitations(token_hash,workspace_id,user_id,expires_at) VALUES($1,$2,$3,now()+interval '24 hours')",[sha(token),a.workspaceId,r.rows[0].id]);
    await audit(tx,a,'member.invite','membership',m.rows[0].id,{roles:b.roles});return {status:201,data:{...m.rows[0],email:b.email,display_name:b.display_name??b.email,invitation_token:token}};
  }
  async patchMember(tx:Tx,a:Actor,memberId:string,input:unknown){
    parse(uuid,memberId);const b=parse(z.object({roles:roles.optional(),active:z.boolean().optional(),successor_id:uuid.optional(),expected_version:version}).strict(),input);
    await tx.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[a.workspaceId]);
    const r=await tx.query('SELECT * FROM memberships WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[memberId,a.workspaceId]);
    if(!r.rowCount)throw new AppError(404,'NOT_FOUND','成员不存在或不可见');const m=r.rows[0];
    if(m.version!==b.expected_version)throw new AppError(409,'VERSION_CONFLICT','成员已修改',{version:m.version});
    if(m.roles.includes('admin')&&m.active&&(b.active===false||(b.roles&&!b.roles.includes('admin')))){
      const n=await tx.query("SELECT count(*)::int n FROM memberships WHERE workspace_id=$1 AND active AND 'admin'=ANY(roles)",[a.workspaceId]);
      if(n.rows[0].n<=1)throw new AppError(422,'LAST_ADMIN','不能停用或降级最后一位管理员');
    }
    if(b.active===false){
      const owned=await tx.query('SELECT id FROM accounts WHERE owner_id=$1 AND workspace_id=$2',[memberId,a.workspaceId]);
      const topics=await tx.query('SELECT id,account_id FROM topics WHERE accepted_owner_id=$1 AND workspace_id=$2 FOR UPDATE',[memberId,a.workspaceId]);
      if((owned.rowCount||topics.rowCount)&&!b.successor_id)throw new AppError(422,'SUCCESSOR_REQUIRED','停用负责人前需指定接替人');
      if(b.successor_id){const successor=await tx.query('SELECT id,roles FROM memberships WHERE id=$1 AND workspace_id=$2 AND active AND id<>$3 FOR SHARE',[b.successor_id,a.workspaceId,memberId]);if(!successor.rowCount)throw new AppError(422,'SUCCESSOR_INVALID','接替人必须是其他有效成员');
        if(topics.rowCount&&!successor.rows[0].roles.some((r:string)=>['admin','operator','editor'].includes(r)))throw new AppError(422,'SUCCESSOR_INVALID','选题接替人必须能处理选题');
        for(const ac of owned.rows){await tx.query('INSERT INTO account_memberships VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[a.workspaceId,ac.id,b.successor_id]);await tx.query('UPDATE accounts SET owner_id=$1,version=version+1,updated_at=now() WHERE id=$2',[b.successor_id,ac.id]);}
        for(const topic of topics.rows){
          await tx.query('INSERT INTO account_memberships VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[a.workspaceId,topic.account_id,b.successor_id]);
          await tx.query('UPDATE topics SET accepted_owner_id=$2,version=version+1,updated_at=now() WHERE id=$1',[topic.id,b.successor_id]);
          await audit(tx,a,'topic.owner_transferred','topic',topic.id,{previous_owner:memberId,owner_id:b.successor_id});
          await tx.query("INSERT INTO notifications(workspace_id,recipient_id,event_key,title,task_ref) VALUES($1,$2,$3,'选题负责人已移交，请核验后续事项',$4) ON CONFLICT DO NOTHING",[a.workspaceId,b.successor_id,'topic.owner:'+topic.id+':'+m.version,'topic:'+topic.id]);
        }
      }
      await tx.query('DELETE FROM sessions WHERE user_id=$1 AND workspace_id=$2',[m.user_id,a.workspaceId]);
    }
    const updated=await tx.query('UPDATE memberships SET roles=COALESCE($1,roles),active=COALESCE($2,active),version=version+1,updated_at=now() WHERE id=$3 RETURNING *',[b.roles??null,b.active??null,memberId]);
    await audit(tx,a,'member.update','membership',memberId,{roles:b.roles,active:b.active,successor_id:b.successor_id});return {status:200,data:updated.rows[0]};
  }
  async logs(a:Actor,q:Record<string,unknown>){
    authorize(a,'admin');const {limit,cursor}=pagination(q);
    const start=q.start?parse(z.iso.datetime({offset:true}),q.start):null;const end=q.end?parse(z.iso.datetime({offset:true}),q.end):null;
    const r=await this.db.query(`SELECT * FROM audit_logs WHERE workspace_id=$1 AND ($2::timestamptz IS NULL OR (occurred_at,id)<($2,$3::uuid)) AND ($4::timestamptz IS NULL OR occurred_at>=$4) AND ($5::timestamptz IS NULL OR occurred_at<$5) ORDER BY occurred_at DESC,id DESC LIMIT $6`,[a.workspaceId,cursor?.at??null,cursor?.id??null,start,end,limit+1]);return page(r.rows,limit,'occurred_at');
  }
  async notifications(a:Actor,q:Record<string,unknown>){
    const {limit,cursor}=pagination(q);if(q.unread!==undefined&&!['true','false'].includes(String(q.unread)))throw new AppError(422,'VALIDATION_ERROR','unread应为true/false');
    const r=await this.db.query(`SELECT * FROM notifications WHERE workspace_id=$1 AND recipient_id=$2 AND ($3::timestamptz IS NULL OR (created_at,id)<($3,$4::uuid)) AND ($5::boolean IS NOT TRUE OR (read_at IS NULL AND superseded_at IS NULL)) ORDER BY created_at DESC,id DESC LIMIT $6`,[a.workspaceId,a.memberId,cursor?.at??null,cursor?.id??null,q.unread==='true',limit+1]);return page(r.rows,limit);
  }
  async readNotification(tx:Tx,a:Actor,notificationId:string){
    parse(uuid,notificationId);const r=await tx.query('UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND workspace_id=$2 AND recipient_id=$3 RETURNING *',[notificationId,a.workspaceId,a.memberId]);
    if(!r.rowCount)throw new AppError(404,'NOT_FOUND','通知不存在或不可见');await audit(tx,a,'notification.read','notification',notificationId);return {status:200,data:r.rows[0]};
  }
  async jobScope(query:Pick<Database,'query'>|Tx,a:Actor,jobId:string,lock=false){
    parse(uuid,jobId);const r=await query.query(`SELECT * FROM jobs WHERE yoyo_job_supported(type,pool,input) AND id=$1 AND workspace_id=$2 AND ($3::boolean OR created_by=$4) ${lock?'FOR UPDATE':''}`,[jobId,a.workspaceId,a.roles.includes('admin'),a.memberId]);
    if(!r.rowCount)throw new AppError(404,'NOT_FOUND','任务不存在或不可见');
    if(r.rows[0].account_id)await this.accountScope(query,a,r.rows[0].account_id);return r.rows[0];
  }
  async jobs(a:Actor,q:Record<string,unknown>){
    const {limit,cursor}=pagination(q);const r=await this.db.query(`SELECT j.* FROM jobs j WHERE yoyo_job_supported(type,pool,input) AND workspace_id=$1 AND ($2::boolean OR created_by=$3) AND ($4::timestamptz IS NULL OR (created_at,id)<($4,$5::uuid)) AND (account_id IS NULL OR $2::boolean OR EXISTS(SELECT 1 FROM account_memberships am WHERE am.account_id=j.account_id AND am.membership_id=$3)) ORDER BY created_at DESC,id DESC LIMIT $6`,[a.workspaceId,a.roles.includes('admin'),a.memberId,cursor?.at??null,cursor?.id??null,limit+1]);return page(r.rows.map(safeJob),limit);
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
    const r=await tx.query("UPDATE jobs SET state='queued',attempts=0,cancel_requested=false,error_code=NULL,result=NULL,available_at=now(),started_at=NULL,finished_at=NULL,lease_token=NULL,lease_until=NULL,version=version+1 WHERE id=$1 RETURNING *",[jobId]);
    await audit(tx,a,'job.retry','job',jobId);return {status:202,data:safeJob(r.rows[0])};
  }
  async monitor(a:Actor){
    authorize(a,'admin');const jobs=await this.db.query("SELECT pool,state,count(*)::int count,min(created_at) oldest FROM jobs WHERE yoyo_job_supported(type,pool,input) AND workspace_id=$1 GROUP BY pool,state ORDER BY pool,state",[a.workspaceId]);
    const processes=await this.db.query("SELECT name,pool,last_seen_at,(last_seen_at>now()-interval '15 seconds') healthy FROM process_health WHERE pool<>'reminder' ORDER BY name");
    const outbox=await this.db.query('SELECT count(*)::int pending FROM outbox WHERE workspace_id=$1 AND dispatched_at IS NULL',[a.workspaceId]);
    return {jobs:jobs.rows,processes:processes.rows,outbox_pending:outbox.rows[0].pending,external_capabilities:{ai:'disabled',ocr:'disabled',sources:'unverified'}};
  }
}
export function safeJob(j:Record<string,any>){const {lease_token,input,...safe}=j;return safe;}
