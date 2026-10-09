import {Database,Tx} from '../../db/src/db';
import {AIGateway,AIFailure} from './ai-gateway';
import {topicSpec,graphicSpec,videoSpec,WorkflowInput} from './ai-workflows';
import {saveTopics} from './topics';
import {generatedPayload,saveGenerated} from './briefs';
import {canonical,AppError} from './protocol';
import {JobHandler} from './jobs';
export class AITasks {
 constructor(readonly db:Database,readonly gateway:()=>AIGateway=()=>new AIGateway(db)){}
 readonly handler:JobHandler=async(job,signal)=>{
  const r=(await this.db.query('SELECT * FROM ai_requests WHERE id=$1 AND workspace_id=$2',[job.input.ai_request_id,job.workspace_id])).rows[0];
  if(!r)return {result:{error_code:'AI_REQUEST_NOT_FOUND'},completionState:'failed'};
  if(r.state==='succeeded')return {result:{ai_request_id:r.id,ai_run_id:r.ai_run_id,reused:true}};
  if(r.state==='cancelled')return {result:{error_code:'AI_REQUEST_CANCELLED'},completionState:'failed'};
  await this.db.query("UPDATE ai_requests SET state='running',job_id=$2 WHERE id=$1",[r.id,job.id]);
  const snapshot=r.snapshot;
  const workflowInput:WorkflowInput={input:snapshot,inputVersion:r.input_version,inputRefs:{account:snapshot.account,rule_set:snapshot.rule_set,sources:snapshot.sources.map((s:any)=>({id:s.id,observation_id:s.observation_id,content_hash:s.content_hash})),assets:snapshot.assets},sourceIds:snapshot.sources.map((s:any)=>s.id),assetIds:snapshot.assets.map((s:any)=>s.asset_id),assetVersionIds:snapshot.assets.map((s:any)=>s.asset_version_id)};
  try{
   const spec=r.kind==='topics'?topicSpec(workflowInput):r.kind==='graphic'?graphicSpec(workflowInput):videoSpec(workflowInput);
   const output=await this.gateway().run({workspaceId:job.workspace_id,memberId:job.created_by,jobId:job.id},spec as any,signal);
   const prepared=r.kind==='topics'?null:generatedPayload(r,output.output);
   const stale=await this.stale(this.db,r);if(stale)return this.failed(r.id,'STALE_INPUT');
   return {result:{ai_request_id:r.id,ai_run_id:output.runId,cached:output.cached},guard:async tx=>{if(await this.stale(tx,r)){await tx.query("UPDATE ai_requests SET state='failed',error_code='STALE_INPUT',finished_at=now() WHERE id=$1",[r.id]);return 'STALE_INPUT';}return null;},effects:async tx=>{
    // Lock account and workspace in the same transaction as Job completion; no result is applied before guards pass.
    if(r.kind==='topics')await saveTopics(tx,r,output.output);else await saveGenerated(tx,r,prepared!);
    await tx.query("UPDATE ai_requests SET state='succeeded',ai_run_id=$2,result=$3,finished_at=now(),error_code=NULL WHERE id=$1 AND state='running'",[r.id,output.runId,JSON.stringify(output.output)]);
   }};
  }catch(e){return this.failed(r.id,signal.aborted?'AI_CANCELLED':e instanceof AIFailure||e instanceof AppError?e.code:'AI_EXECUTION_FAILED');}
 };
 private failed(requestId:string,code:string){return {result:{ai_request_id:requestId,error_code:code},completionState:'failed' as const,effects:async(tx:Tx)=>{await tx.query("UPDATE ai_requests SET state='failed',error_code=$2,finished_at=now() WHERE id=$1",[requestId,code]);}};}
 private async stale(query:Pick<Database,'query'>|Tx,r:any){
  const account=(await query.query('SELECT version FROM accounts WHERE workspace_id=$1 AND id=$2 FOR SHARE',[r.workspace_id,r.account_id])).rows[0];
  const workspace=(await query.query('SELECT version FROM workspaces WHERE id=$1 FOR SHARE',[r.workspace_id])).rows[0];
  const member=(await query.query('SELECT active,roles FROM memberships WHERE workspace_id=$1 AND id=$2 FOR SHARE',[r.workspace_id,r.created_by])).rows[0];
  const rule=(await query.query("SELECT id,version FROM rule_sets WHERE workspace_id=$1 AND status='active' FOR SHARE",[r.workspace_id])).rows[0];
  if(!account||account.version!==r.snapshot.account.version||workspace?.version!==r.snapshot.workspace_version||!member?.active||((rule?.id??null)!==(r.snapshot.rule_set?.id??null))||((rule?.version??null)!==(r.snapshot.rule_set?.version??null)))return true;
  if(!member.roles.some((role:string)=>['admin','editor','operator'].includes(role)))return true;
  if(!member.roles.includes('admin')&&!(await query.query('SELECT 1 FROM account_memberships WHERE account_id=$1 AND membership_id=$2',[r.account_id,r.created_by])).rowCount)return true;
  if(r.kind!=='topics'){const content=(await query.query('SELECT current_revision_id,version,business_status FROM contents WHERE workspace_id=$1 AND id=$2 FOR SHARE',[r.workspace_id,r.snapshot.content_id])).rows[0];const base=(await query.query('SELECT version,payload,frozen FROM content_revisions WHERE workspace_id=$1 AND id=$2 FOR SHARE',[r.workspace_id,r.snapshot.base_revision_id])).rows[0];if(!content||content.version!==r.snapshot.content_version||content.current_revision_id!==r.snapshot.base_revision_id||!['draft','in_production'].includes(content.business_status)||!base||base.frozen||base.version!==(r.snapshot.base_revision_version??1)||canonical(base.payload)!==canonical(r.snapshot.base_payload))return true;}
  for(const asset of r.snapshot.assets){const current=(await query.query('SELECT business_status,version FROM assets WHERE workspace_id=$1 AND id=$2 FOR SHARE',[r.workspace_id,asset.asset_id])).rows[0];if(!current||current.business_status!=='usable'||current.version!==asset.asset_version)return true;}
  return false;
 }
}
