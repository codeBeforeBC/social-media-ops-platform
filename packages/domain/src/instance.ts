import {randomUUID} from 'node:crypto';
import type {Database,Tx} from '../../db/src/db';
import {AppError,Actor,parse,uuid} from './protocol';

type Query=Pick<Database,'query'>|Tx;

const selection=()=>({workspace:process.env.YOYO_DEFAULT_WORKSPACE_ID?parse(uuid,process.env.YOYO_DEFAULT_WORKSPACE_ID):null,member:process.env.YOYO_DEFAULT_MEMBER_ID?parse(uuid,process.env.YOYO_DEFAULT_MEMBER_ID):null});
async function existingContext(q:Query,selectedWorkspace:string|null,selectedMember:string|null){
  const workspaces=(await q.query('SELECT id FROM workspaces WHERE ($1::uuid IS NULL OR id=$1) ORDER BY id',[selectedWorkspace])).rows;
  if(!workspaces.length&&(selectedWorkspace||selectedMember))throw new AppError(503,'INSTANCE_SELECTION_INVALID','指定的默认上下文不存在');
  if(workspaces.length>1)throw new AppError(503,'INSTANCE_SELECTION_REQUIRED','旧库有多个工作区，请配置YOYO_DEFAULT_WORKSPACE_ID');
  if(!workspaces.length)return {workspace:null,member:null};
  const members=(await q.query("SELECT id,user_id FROM memberships WHERE workspace_id=$1 AND active AND 'admin'=ANY(roles) AND ($2::uuid IS NULL OR id=$2) ORDER BY id",[workspaces[0].id,selectedMember])).rows;
  if(!members.length&&selectedMember)throw new AppError(503,'INSTANCE_SELECTION_INVALID','指定成员不是该工作区的有效管理员');
  if(members.length>1)throw new AppError(503,'INSTANCE_SELECTION_REQUIRED','旧库有多个有效成员，请配置YOYO_DEFAULT_MEMBER_ID');
  return {workspace:workspaces[0].id as string,member:members[0]??null};
}
export async function preflightInstance(q:Query){const selected=selection();await existingContext(q,selected.workspace,selected.member);}

export async function ensureInstance(db:Database){
  const {workspace:selectedWorkspace,member:selectedMember}=selection();
  await db.transaction(async tx=>{
    await tx.query('INSERT INTO instance_state(id) VALUES(1) ON CONFLICT DO NOTHING');
    const state=(await tx.query('SELECT * FROM instance_state WHERE id=1 FOR UPDATE')).rows[0];
    if(state.default_workspace_id){
      if(selectedWorkspace&&selectedWorkspace!==state.default_workspace_id||selectedMember&&selectedMember!==state.default_member_id)throw new AppError(503,'INSTANCE_SELECTION_CONFLICT','实例已有默认上下文，不能自动切换');
      const actor=await defaultActor(tx,'startup');if(!actor.roles.includes('admin'))throw new AppError(503,'INSTANCE_CONTEXT_INVALID','默认身份无本地管理能力');return;
    }
    const existing=await existingContext(tx,selectedWorkspace,selectedMember);
    const workspace=existing.workspace??(await tx.query("INSERT INTO workspaces(name) VALUES('我的工作台') RETURNING id")).rows[0].id;
    let members=existing.member?[existing.member]:[];
    if(!members.length){
      const user=(await tx.query("INSERT INTO users(email,display_name,password_hash) VALUES($1,'本地使用者',NULL) RETURNING id",[randomUUID()+'@local.invalid'])).rows[0];
      members=(await tx.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['admin']) RETURNING id,user_id",[workspace,user.id])).rows;
    }
    await tx.query('UPDATE instance_state SET default_workspace_id=$1,default_member_id=$2,initialized_at=COALESCE(initialized_at,now()) WHERE id=1',[workspace,members[0].id]);
    await tx.query("UPDATE jobs SET state='failed',error_code='INSTANCE_SCOPE_UNSELECTED',finished_at=now(),lease_token=NULL,lease_until=NULL,version=version+1 WHERE workspace_id<>$1 AND state IN ('queued','running')",[workspace]);
    await tx.query('UPDATE outbox SET retired_at=COALESCE(retired_at,now()) WHERE workspace_id<>$1 AND dispatched_at IS NULL',[workspace]);
    await tx.query("INSERT INTO audit_logs(workspace_id,actor_type,action,object_type,object_id,request_id) VALUES($1,'service','instance.local_context_initialized','membership',$2,$3)",[workspace,members[0].id,randomUUID()]);
  });
}

export async function defaultActor(q:Query,requestId:string):Promise<Actor>{
  const row=(await q.query('SELECT m.id,m.workspace_id,m.user_id,m.roles FROM instance_state s JOIN memberships m ON (m.workspace_id,m.id)=(s.default_workspace_id,s.default_member_id) WHERE s.id=1 AND m.active FOR SHARE OF s,m')).rows[0];
  if(!row)throw new AppError(503,'INSTANCE_CONTEXT_INVALID','默认实例上下文不可用，请检查实例初始化');
  return {workspaceId:row.workspace_id,memberId:row.id,userId:row.user_id,roles:row.roles,requestId};
}

export async function reloadActor(tx:Tx,a:Actor){
  const current=await defaultActor(tx,a.requestId);
  if(current.workspaceId!==a.workspaceId||current.memberId!==a.memberId||current.userId!==a.userId)throw new AppError(409,'INSTANCE_CONTEXT_CHANGED','实例上下文已变化，请重新加载');
  return current;
}
