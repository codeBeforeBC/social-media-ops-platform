import {activeStrategies} from './reports';
import {canonical} from './protocol';
import {Database,Tx} from '../../db/src/db';
import {AIGateway,AIFailure} from './ai-gateway';
import {topicSpec,WorkflowInput} from './ai-workflows';
import {saveTopics} from './topics';
import {AppError} from './protocol';
import {JobHandler} from './jobs';
export class AITasks {
 constructor(readonly db:Database,readonly gateway:()=>AIGateway=()=>new AIGateway(db)){}
 readonly handler:JobHandler=async(job,signal)=>{
  const r=(await this.db.query('SELECT * FROM ai_requests WHERE id=$1 AND workspace_id=$2',[job.input.ai_request_id,job.workspace_id])).rows[0];
  if(!r)return {result:{error_code:'AI_REQUEST_NOT_FOUND'},completionState:'failed'};
  if(r.kind!=='topics'||r.snapshot.scope_version!=='v1.2')return this.failed(r.id,'SCOPE_RETIRED');
  if(r.state==='succeeded')return {result:{ai_request_id:r.id,ai_run_id:r.ai_run_id,reused:true}};
  if(r.state==='cancelled')return {result:{error_code:'AI_REQUEST_CANCELLED'},completionState:'failed'};
  await this.db.query("UPDATE ai_requests SET state='running',job_id=$2 WHERE id=$1",[r.id,job.id]);
  const snapshot=r.snapshot;
  const workflowInput:WorkflowInput={input:snapshot,inputVersion:r.input_version,inputRefs:{account:snapshot.account,sources:snapshot.sources.map((s:any)=>({id:s.id,observation_id:s.observation_id,content_hash:s.content_hash}))},sourceIds:snapshot.sources.map((s:any)=>s.id)};
  try{
   const spec=topicSpec(workflowInput);
   const output=await this.gateway().run({workspaceId:job.workspace_id,memberId:job.created_by,jobId:job.id},spec as any,signal);
   const stale=await this.stale(this.db,r);if(stale)return this.failed(r.id,'STALE_INPUT');
   return {result:{ai_request_id:r.id,ai_run_id:output.runId,cached:output.cached},guard:async tx=>{if(await this.stale(tx,r)){await tx.query("UPDATE ai_requests SET state='failed',error_code='STALE_INPUT',finished_at=now() WHERE id=$1",[r.id]);return 'STALE_INPUT';}return null;},effects:async tx=>{
    // Lock account and workspace in the same transaction as Job completion; no result is applied before guards pass.
    await saveTopics(tx,r,output.output);
    await tx.query("UPDATE ai_requests SET state='succeeded',ai_run_id=$2,result=$3,finished_at=now(),error_code=NULL WHERE id=$1 AND state='running'",[r.id,output.runId,JSON.stringify(output.output)]);
   }};
  }catch(e){return this.failed(r.id,signal.aborted?'AI_CANCELLED':e instanceof AIFailure||e instanceof AppError?e.code:'AI_EXECUTION_FAILED');}
 };
 private failed(requestId:string,code:string){return {result:{ai_request_id:requestId,error_code:code},completionState:'failed' as const,effects:async(tx:Tx)=>{await tx.query("UPDATE ai_requests SET state='failed',error_code=$2,finished_at=now() WHERE id=$1",[requestId,code]);}};}
 private async stale(query:Pick<Database,'query'>|Tx,r:any){
  const account=(await query.query('SELECT version FROM accounts WHERE workspace_id=$1 AND id=$2 FOR SHARE',[r.workspace_id,r.account_id])).rows[0];
  const workspace=(await query.query('SELECT version FROM workspaces WHERE id=$1 FOR SHARE',[r.workspace_id])).rows[0];
  const member=(await query.query('SELECT active,roles FROM memberships WHERE workspace_id=$1 AND id=$2 FOR SHARE',[r.workspace_id,r.created_by])).rows[0];
  if(r.kind!=='topics'||r.snapshot.scope_version!=='v1.2'||!account||account.version!==r.snapshot.account.version||workspace?.version!==r.snapshot.workspace_version||!member?.active)return true;
  if(!member.roles.some((role:string)=>['admin','editor','operator'].includes(role)))return true;
  if(canonical(r.snapshot.strategies??[])!==canonical(await activeStrategies(query,r.workspace_id,r.account_id)))return true;
  if(!member.roles.includes('admin')&&!(await query.query('SELECT 1 FROM account_memberships WHERE account_id=$1 AND membership_id=$2',[r.account_id,r.created_by])).rowCount)return true;
  return false;
 }
}
