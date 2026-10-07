import {hash,verify,argon2id} from 'argon2';
import {Request,Response} from 'express';
import {z} from 'zod';
import {Database,Tx} from '../../../packages/db/src/db';
import {config,setupToken} from '../../../packages/domain/src/config';
import {AppError,Actor,parse,text,roles,sha,secret,equalSecret,permissions} from '../../../packages/domain/src/protocol';
export const cookieName='yoyo_session';
const password=z.string().min(12).max(128);
const email=z.email().max(254).transform(s=>s.toLowerCase());
export const passwordHash=(p:string)=>hash(p,{type:argon2id,memoryCost:19456,timeCost:2,parallelism:1});
export class Auth {
  constructor(readonly db:Database){}
  cookie(res:Response,token:string,seconds:number){res.cookie(cookieName,token,{httpOnly:true,sameSite:'lax',secure:config.secure,path:'/',maxAge:seconds*1000});}
  async csrf(req:Request,res:Response){
    const old=req.cookies?.[cookieName];const csrf=secret();
    if(old){const r=await this.db.query('UPDATE sessions SET csrf_hash=$1 WHERE token_hash=$2 AND expires_at>now() AND (user_id IS NULL OR last_seen_at>now()-$3::int*interval \'1 second\') RETURNING token_hash',[sha(csrf),sha(old),config.idleSeconds]);if(r.rowCount)return {csrf_token:csrf};}
    const token=secret();await this.db.query("INSERT INTO sessions(token_hash,csrf_hash,expires_at) VALUES($1,$2,now()+interval '15 minutes')",[sha(token),sha(csrf)]);this.cookie(res,token,900);return {csrf_token:csrf};
  }
  async checkCsrf(req:Request){
    if(req.headers.origin!==config.origin)throw new AppError(403,'ORIGIN_REJECTED','请求来源不匹配');
    const token=req.cookies?.[cookieName];const csrf=req.headers['x-csrf-token'];
    if(typeof token!=='string'||typeof csrf!=='string')throw new AppError(403,'CSRF_INVALID','请刷新页面后重试');
    const r=await this.db.query('SELECT csrf_hash FROM sessions WHERE token_hash=$1 AND expires_at>now() AND (user_id IS NULL OR last_seen_at>now()-$2::int*interval \'1 second\')',[sha(token),config.idleSeconds]);
    if(!r.rowCount||!equalSecret(r.rows[0].csrf_hash,sha(csrf)))throw new AppError(403,'CSRF_INVALID','会话或请求令牌已失效');
  }
  async actor(req:Request):Promise<Actor>{
    const token=req.cookies?.[cookieName];if(typeof token!=='string')throw new AppError(401,'UNAUTHENTICATED','请先登录');
    const r=await this.db.query(`SELECT s.user_id,s.workspace_id,m.id member_id,m.roles FROM sessions s JOIN memberships m ON m.user_id=s.user_id AND m.workspace_id=s.workspace_id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND s.last_seen_at>now()-$2::int*interval '1 second' AND m.active`,[sha(token),config.idleSeconds]);
    if(!r.rowCount)throw new AppError(401,'SESSION_EXPIRED','登录已过期或成员已停用');
    const row=r.rows[0];
    if(req.query.workspace_id!==undefined&&req.query.workspace_id!==row.workspace_id)throw new AppError(404,'NOT_FOUND','工作区不存在或不可见');
    await this.db.query('UPDATE sessions SET last_seen_at=now() WHERE token_hash=$1',[sha(token)]);
    return {userId:row.user_id,memberId:row.member_id,workspaceId:row.workspace_id,roles:row.roles,sessionHash:sha(token),requestId:resRequestId(req)};
  }
  async limit(kind:string,key:string){
    const r=await this.db.query(`INSERT INTO login_limits(key,attempts,reset_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET
      attempts=CASE WHEN login_limits.reset_at<=now() THEN 1 ELSE login_limits.attempts+1 END,
      reset_at=CASE WHEN login_limits.reset_at<=now() THEN now()+interval '15 minutes' ELSE login_limits.reset_at END RETURNING attempts`,[kind+':'+sha(key)]);
    if(r.rows[0].attempts>10)throw new AppError(429,'RATE_LIMITED','尝试次数过多，请稍后重试',{},true);
  }
  async setup(req:Request){
    await this.checkCsrf(req);await this.limit('setup',req.ip??'local');
    const input=parse(z.object({setup_token:text(200),email,password,display_name:text(),workspace_name:text()}).strict(),req.body);
    if(!equalSecret(input.setup_token,setupToken()))throw new AppError(403,'SETUP_TOKEN_INVALID','实例初始化凭据无效');
    const pw=await passwordHash(input.password);
    return this.db.transaction(async tx=>{
      const lock=await tx.query('SELECT initialized_at FROM instance_state WHERE id=1 FOR UPDATE');
      if(lock.rows[0].initialized_at)throw new AppError(409,'ALREADY_INITIALIZED','实例已完成初始化');
      const w=await tx.query('INSERT INTO workspaces(name) VALUES($1) RETURNING id',[input.workspace_name]);
      const u=await tx.query('INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id',[input.email,input.display_name,pw]);
      const m=await tx.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['admin']) RETURNING id",[w.rows[0].id,u.rows[0].id]);
      await tx.query('UPDATE instance_state SET initialized_at=now() WHERE id=1');
      await tx.query(`INSERT INTO audit_logs(workspace_id,actor_id,actor_type,action,object_type,object_id,request_id) VALUES($1,$2,'user','instance.initialize','workspace',$1,$3)`,[w.rows[0].id,m.rows[0].id,resRequestId(req)]);
      return {initialized:true};
    });
  }
  async login(req:Request,res:Response){
    await this.checkCsrf(req);
    const input=parse(z.object({email,password:z.string().min(1).max(128),workspace_id:z.string().uuid().optional()}).strict(),req.body);
    await this.limit('login-ip',req.ip??'local');await this.limit('login-email',input.email);
    const r=await this.db.query(`SELECT u.id,u.password_hash,m.workspace_id FROM users u JOIN memberships m ON m.user_id=u.id
      WHERE u.email=$1 AND m.active AND ($2::uuid IS NULL OR m.workspace_id=$2) ORDER BY m.created_at LIMIT 1`,[input.email,input.workspace_id??null]);
    const dummy='$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$5PN13xKYHxStydAQ97IvBKFVkd+9zKl1CVHEfzGIqtQ';
    const ok=await verify(r.rows[0]?.password_hash??dummy,input.password).catch(()=>false);
    if(!r.rowCount||!ok)throw new AppError(401,'INVALID_CREDENTIALS','邮箱或密码不正确');
    const token=secret(),csrf=secret();
    await this.db.transaction(async tx=>{
      await tx.query('DELETE FROM sessions WHERE token_hash=$1',[sha(req.cookies[cookieName])]);
      await tx.query(`INSERT INTO sessions(token_hash,csrf_hash,user_id,workspace_id,expires_at) VALUES($1,$2,$3,$4,now()+$5::int*interval '1 second')`,[sha(token),sha(csrf),r.rows[0].id,r.rows[0].workspace_id,config.absoluteSeconds]);
    });
    this.cookie(res,token,config.absoluteSeconds);return {authenticated:true,csrf_token:csrf,expires_at:new Date(Date.now()+config.absoluteSeconds*1000).toISOString()};
  }
  async me(a:Actor){
    const w=await this.db.prisma.workspace.findUnique({where:{id:a.workspaceId}});
    const u=await this.db.query('SELECT id,email,display_name FROM users WHERE id=$1',[a.userId]);
    const session=await this.db.query('SELECT expires_at FROM sessions WHERE token_hash=$1',[a.sessionHash]);
    return {user:u.rows[0],membership:{id:a.memberId,roles:a.roles,workspace_id:a.workspaceId},workspace:w,permissions:permissions(a),expires_at:session.rows[0]?.expires_at};
  }
  async acceptInvite(req:Request){
    await this.checkCsrf(req);await this.limit('invite',req.ip??'local');
    const input=parse(z.object({invitation_token:text(200),password}).strict(),req.body);const pw=await passwordHash(input.password);
    return this.db.transaction(async tx=>{
      const r=await tx.query(`SELECT i.* FROM invitations i JOIN memberships m ON m.workspace_id=i.workspace_id AND m.user_id=i.user_id WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now() AND m.active FOR UPDATE OF i`,[sha(input.invitation_token)]);
      if(!r.rowCount)throw new AppError(422,'INVITE_INVALID','邀请已使用、过期或停用');
      await tx.query('UPDATE users SET password_hash=$1 WHERE id=$2',[pw,r.rows[0].user_id]);await tx.query('UPDATE invitations SET accepted_at=now() WHERE token_hash=$1',[sha(input.invitation_token)]);
      await tx.query('DELETE FROM sessions WHERE user_id=$1',[r.rows[0].user_id]);return {accepted:true};
    });
  }
}
export function resRequestId(req:Request):string{return (req as Request&{requestId:string}).requestId;}
export async function reloadActor(tx:Tx,a:Actor):Promise<Actor>{
  const session=await tx.query('SELECT token_hash FROM sessions WHERE token_hash=$1 AND user_id=$2 AND workspace_id=$3 AND expires_at>now() AND last_seen_at>now()-$4::int*interval \'1 second\' FOR SHARE',[a.sessionHash,a.userId,a.workspaceId,config.idleSeconds]);
  if(!session.rowCount)throw new AppError(401,'SESSION_EXPIRED','登录已过期或已撤销');
  const r=await tx.query('SELECT roles,active FROM memberships WHERE id=$1 AND workspace_id=$2 FOR SHARE',[a.memberId,a.workspaceId]);
  if(!r.rowCount||!r.rows[0].active)throw new AppError(401,'SESSION_EXPIRED','成员已停用');return {...a,roles:r.rows[0].roles};
}
