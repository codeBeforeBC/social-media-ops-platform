import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {Database,Tx} from '../../db/src/db';
import {Actor,AppError,parse,text,uuid,version,id,pagination,page} from './protocol';
import {xhsAccountIdentity} from './xhs-account';
import type {JobHandler} from './jobs';
export const profileRef=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const platformId=z.string().regex(/^[a-f0-9]{24}$/);
const capability=z.enum(['unknown','supported','unsupported']);
export const accountVerificationResult=z.object({
 public_status:z.enum(['matched','inconclusive','not_found']),session_status:z.enum(['unknown','matched','mismatched','auth_required','unsupported']),
 public_profile:z.object({id:platformId,nickname:z.string().min(1).max(200),display_handle:z.string().max(200).nullable()}).strict().nullable(),
 session_id:platformId.nullable(),observed_at:z.string().datetime({offset:true}),adapter_version:z.string().min(1).max(200),
 capabilities:z.object({public_identity:capability,current_session_identity:capability,own_account_metrics:capability}).strict(),
 error_code:z.enum(['AUTH_REQUIRED','ACCOUNT_MISMATCH','ACCOUNT_NOT_FOUND','BROWSER_UNAVAILABLE','BROWSER_BUSY','PROFILE_REQUIRED','PROFILE_UNAVAILABLE','RATE_LIMITED','ACCESS_DENIED','SOURCE_CHANGED','PARSE_FAILED','TIMEOUT','SOURCE_UNAVAILABLE','UNSUPPORTED','BRIDGE_UNSUPPORTED']).nullable()
}).strict();
export type AccountVerificationResult=z.infer<typeof accountVerificationResult>;
export async function bridgeRequest(path:'/profiles'|'/accounts/verify',body?:unknown,signal?:AbortSignal){
 let base:URL,token:string;try{base=new URL(process.env.SOURCE_BRIDGE_URL??'');if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw Error();token=process.env.SOURCE_BRIDGE_TOKEN||readFileSync(process.env.SOURCE_BRIDGE_TOKEN_FILE??'','utf8').trim();if(!token)throw Error();}catch{throw new AppError(503,'BROWSER_UNAVAILABLE','浏览器桥接未配置或不可用');}
 const requestSignal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(body?90000:5000)]);
 try{
  const r=await fetch(new URL(path,base),{method:body?'POST':'GET',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:requestSignal});
  const reader=r.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let size=0;try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536)throw Error();chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
  const raw=JSON.parse(Buffer.concat(chunks).toString());
  if(!r.ok||raw.ok!==true){const code=r.status===409?'BROWSER_BUSY':r.status===404?'BRIDGE_UNSUPPORTED':['PROFILE_UNAVAILABLE','PROFILE_REQUIRED'].includes(raw.error_code)?raw.error_code:'BROWSER_UNAVAILABLE';throw new AppError(503,code,code==='BROWSER_BUSY'?'浏览器档案正在使用，请稍后重试':'浏览器桥接不可用或不支持账号验证');}
  return raw;
 }catch(e){if(e instanceof AppError)throw e;throw new AppError(503,requestSignal.aborted?'TIMEOUT':'BROWSER_UNAVAILABLE','浏览器验证未完成，请检查档案后重试');}
}
export async function connectedAccountProfiles(){
 const raw=await bridgeRequest('/profiles');return parse(z.object({items:z.array(z.object({id:profileRef}).strict()).max(50)}).strict(),{items:raw.items});
}
export async function accountScope(q:Pick<Database,'query'>|Tx,a:Actor,accountId:string,lock=false){
 parse(uuid,accountId);const row=await q.query(`SELECT ac.* FROM accounts ac WHERE ac.id=$1 AND ac.workspace_id=$2 AND ($3::boolean OR EXISTS(SELECT 1 FROM account_memberships am WHERE am.account_id=ac.id AND am.membership_id=$4)) ${lock?'FOR UPDATE OF ac':''}`,[accountId,a.workspaceId,a.roles.includes('admin'),a.memberId]);
 if(!row.rowCount)throw new AppError(404,'NOT_FOUND','账号不存在或不可见');return row.rows[0];
}
const observationSql=`SELECT v.*,j.state,j.started_at,j.finished_at,j.error_code FROM account_verifications v JOIN jobs j ON j.id=v.job_id AND j.workspace_id=v.workspace_id`;
export class AccountVerifications{
 constructor(readonly db:Database){}
 async history(a:Actor,accountId:string,query:Record<string,unknown>){
  await accountScope(this.db,a,accountId);const {limit,cursor}=pagination(query);
  const rows=await this.db.query(observationSql+' WHERE v.workspace_id=$1 AND v.account_id=$2 AND ($3::timestamptz IS NULL OR (v.requested_at,v.id)<($3,$4::uuid)) ORDER BY v.requested_at DESC,v.id DESC LIMIT $5',[a.workspaceId,accountId,cursor?.at??null,cursor?.id??null,limit+1]);return page(rows.rows,limit,'requested_at');
 }
 async get(a:Actor,accountId:string,verificationId:string){await accountScope(this.db,a,accountId);parse(uuid,verificationId);const r=await this.db.query(observationSql+' WHERE v.workspace_id=$1 AND v.account_id=$2 AND v.id=$3',[a.workspaceId,accountId,verificationId]);if(!r.rowCount)throw new AppError(404,'NOT_FOUND','验证记录不存在或不可见');return r.rows[0];}
 async summary(q:Pick<Database,'query'>|Tx,ac:Record<string,any>){
  const rows=await q.query(observationSql+" WHERE v.workspace_id=$1 AND v.account_id=$2 AND (v.id=(SELECT id FROM account_verifications WHERE workspace_id=$1 AND account_id=$2 ORDER BY requested_at DESC,id DESC LIMIT 1) OR v.id=(SELECT id FROM account_verifications WHERE workspace_id=$1 AND account_id=$2 AND result->>'public_status'='matched' ORDER BY requested_at DESC,id DESC LIMIT 1)) ORDER BY v.requested_at DESC,v.id DESC",[ac.workspace_id,ac.id]);
  const latest=rows.rows[0]??null,lastSuccess=rows.rows.find(v=>v.result?.public_status==='matched'&&v.applied_at)??null;
  const current=latest?.binding_version===ac.identity_binding_version&&latest?.browser_profile_ref===ac.browser_profile_ref;
  const fresh=!!current&&!!latest.applied_at&&new Date(latest.result.observed_at).getTime()>Date.now()-86400000;
  return {latest,last_success:lastSuccess,current:!!current,stale:!!latest&&!fresh,confirmed:!!fresh&&ac.confirmed_verification_id===latest.id,as_of:new Date().toISOString()};
 }
 async detail(a:Actor,accountId:string){const ac=await accountScope(this.db,a,accountId);return {...ac,verification:await this.summary(this.db,ac)};}
 async list(a:Actor){
  const rows=await this.db.query('SELECT * FROM accounts ac WHERE workspace_id=$1 AND ($2::boolean OR EXISTS(SELECT 1 FROM account_memberships am WHERE am.account_id=ac.id AND am.membership_id=$3)) ORDER BY created_at,id',[a.workspaceId,a.roles.includes('admin'),a.memberId]);
  return {items:await Promise.all(rows.rows.map(async ac=>({...ac,verification:await this.summary(this.db,ac)})))};
 }
 async create(tx:Tx,a:Actor,accountId:string,input:unknown){
  const b=parse(z.object({expected_version:version,binding_version:version}).strict(),input),ac=await accountScope(tx,a,accountId,true);
  if(ac.platform!=='xiaohongshu')throw new AppError(422,'UNSUPPORTED','仅支持小红书账号验证');
  const identity=xhsAccountIdentity(ac.platform_user_id);if(!identity)throw new AppError(422,'INVALID_ACCOUNT_ID','原登记内部ID格式不正确，请先核对目标账号，不能自动替换身份');
  if(!ac.browser_profile_ref)throw new AppError(422,'PROFILE_REQUIRED','请先选择并保存浏览器档案');
  if(ac.identity_binding_version!==b.binding_version)throw new AppError(409,'VERSION_CONFLICT','浏览器绑定已更新，请刷新账号');
  const active=await tx.query(observationSql+" WHERE v.workspace_id=$1 AND v.account_id=$2 AND v.binding_version=$3 AND j.state IN ('queued','running') ORDER BY v.requested_at DESC LIMIT 1",[a.workspaceId,accountId,b.binding_version]);
  if(active.rowCount)return {status:202,data:{verification:active.rows[0],reused:true}};
  if(ac.version!==b.expected_version)throw new AppError(409,'VERSION_CONFLICT','账号已更新，请刷新后验证');
  if(ac.verification_next_at&&new Date(ac.verification_next_at).getTime()>Date.now())throw new AppError(429,'RATE_LIMITED','验证有60秒冷却，请稍后重试',{retry_at:new Date(ac.verification_next_at).toISOString()},true);
  const verificationId=id();const out=await tx.query("INSERT INTO outbox(workspace_id,account_id,event_key,event_type,payload) VALUES($1,$2,$3,'account.verify',$4) RETURNING id",[a.workspaceId,accountId,'account.verify:'+verificationId,JSON.stringify({pool:'general',created_by:a.memberId,request_id:a.requestId,input:{verification_id:verificationId}})]);
  const job=await tx.query("INSERT INTO jobs(workspace_id,account_id,created_by,outbox_id,type,pool,input,request_id,timeout_seconds,max_attempts) VALUES($1,$2,$3,$4,'account.verify','general',$5,$6,100,2) RETURNING *",[a.workspaceId,accountId,a.memberId,out.rows[0].id,JSON.stringify({verification_id:verificationId}),a.requestId]);
  await tx.query('INSERT INTO account_verifications(id,workspace_id,account_id,binding_version,expected_platform_user_id,browser_profile_ref,requested_by,job_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[verificationId,a.workspaceId,accountId,b.binding_version,identity.id,ac.browser_profile_ref,a.memberId,job.rows[0].id]);
  await tx.query("UPDATE accounts SET verification_next_at=now()+interval '60 seconds' WHERE id=$1",[accountId]);
  await tx.query("INSERT INTO audit_logs(workspace_id,actor_id,actor_type,action,object_type,object_id,details,request_id) VALUES($1,$2,'user','account.verify','account',$3,$4,$5)",[a.workspaceId,a.memberId,accountId,JSON.stringify({verification_id:verificationId,binding_version:b.binding_version}),a.requestId]);
  const row=(await tx.query(observationSql+' WHERE v.id=$1',[verificationId])).rows[0];return {status:202,data:{verification:row,reused:false}};
 }
 async confirm(tx:Tx,a:Actor,accountId:string,input:unknown){
  const b=parse(z.object({verification_id:uuid,expected_version:version,confirmed:z.literal(true)}).strict(),input),ac=await accountScope(tx,a,accountId,true);
  if(ac.version!==b.expected_version)throw new AppError(409,'VERSION_CONFLICT','账号已更新，请重新核对');
  const summary=await this.summary(tx,ac),v=summary.latest;
  if(!v||v.id!==b.verification_id||!summary.current||summary.stale||!v.applied_at||v.result?.public_status!=='matched'||v.result.public_profile?.id!==xhsAccountIdentity(ac.platform_user_id)?.id||!['succeeded','partial'].includes(v.state))throw new AppError(422,'STALE_VERIFICATION','请使用当前绑定下最新且24小时内的公开身份匹配结果');
  if(ac.confirmed_verification_id===v.id)return {status:200,data:ac};
  const r=await tx.query('UPDATE accounts SET confirmed_verification_id=$2,confirmed_at=now(),version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[accountId,v.id]);
  await tx.query("INSERT INTO audit_logs(workspace_id,actor_id,actor_type,action,object_type,object_id,details,request_id) VALUES($1,$2,'user','account.identity.confirm','account',$3,$4,$5)",[a.workspaceId,a.memberId,accountId,JSON.stringify({verification_id:v.id,statement:'人工确认管理此目标账号，不代替平台授权'}),a.requestId]);return {status:200,data:r.rows[0]};
 }
}
const unavailable=(code:AccountVerificationResult['error_code']):AccountVerificationResult=>({public_status:'inconclusive',session_status:code==='AUTH_REQUIRED'?'auth_required':'unknown',public_profile:null,session_id:null,observed_at:new Date().toISOString(),adapter_version:'account-bridge-v1',capabilities:{public_identity:'unknown',current_session_identity:'unknown',own_account_metrics:'unknown'},error_code:code});
export type AccountIdentityReader=(input:{profile:string;target_id:string},signal:AbortSignal)=>Promise<unknown>;
export const readAccountIdentity:AccountIdentityReader=async(input,signal)=>{const raw=await bridgeRequest('/accounts/verify',input,signal);return raw.result;};
export class AccountVerificationTasks{
 constructor(readonly db:Database,readonly reader:AccountIdentityReader=readAccountIdentity){}
 handler:JobHandler=async(job,signal)=>{
  const verificationId=parse(uuid,job.input.verification_id);
  const row=(await this.db.query('SELECT * FROM account_verifications WHERE id=$1 AND workspace_id=$2 AND account_id=$3 AND job_id=$4',[verificationId,job.workspace_id,job.account_id,job.id])).rows[0];
  if(!row)throw new Error('UNSUPPORTED_JOB');
  const valid=async(q:Pick<Database,'query'>|Tx)=>{
   const ac=(await q.query('SELECT * FROM accounts WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[row.account_id,row.workspace_id])).rows[0];
   return !!ac&&ac.platform==='xiaohongshu'&&ac.identity_binding_version===row.binding_version&&ac.browser_profile_ref===row.browser_profile_ref&&xhsAccountIdentity(ac.platform_user_id)?.id===row.expected_platform_user_id;
  };
  let result:AccountVerificationResult;
  if(!await valid(this.db))return {result:{error_code:'STALE_INPUT'},completionState:'failed'};
  try{
   result=parse(accountVerificationResult,await this.reader({profile:row.browser_profile_ref,target_id:row.expected_platform_user_id},signal));
   if((result.public_status==='matched'&&result.public_profile?.id!==row.expected_platform_user_id)||Math.abs(Date.now()-new Date(result.observed_at).getTime())>300000||
    (result.session_status==='matched'&&result.session_id!==row.expected_platform_user_id)||(result.session_status==='mismatched'&&(!result.session_id||result.session_id===row.expected_platform_user_id)))result=unavailable('SOURCE_CHANGED');
  }catch(e){const code=e instanceof AppError?e.code:'';result=unavailable(['AUTH_REQUIRED','BROWSER_BUSY','BROWSER_UNAVAILABLE','PROFILE_UNAVAILABLE','PROFILE_REQUIRED','TIMEOUT','BRIDGE_UNSUPPORTED'].includes(code)?code as AccountVerificationResult['error_code']:'PARSE_FAILED');}
  const state=result.public_status==='matched'?(result.session_status==='matched'?'succeeded':'partial'):'failed';
  return {result,completionState:state,guard:async tx=>await valid(tx)?null:'STALE_INPUT',effects:async tx=>{
   await tx.query('UPDATE account_verifications SET result=$2,applied_at=now() WHERE id=$1 AND result IS NULL',[row.id,JSON.stringify(result)]);
   await tx.query("INSERT INTO audit_logs(workspace_id,actor_type,action,object_type,object_id,details,request_id) VALUES($1,'service','account.verification.finished','account_verification',$2,$3,$4)",[row.workspace_id,row.id,JSON.stringify({public_status:result.public_status,session_status:result.session_status,error_code:result.error_code}),job.request_id]);
  }};
 };
}
