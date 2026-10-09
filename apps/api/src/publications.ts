import {z} from 'zod';
import {Tx} from '../../../packages/db/src/db';
import {Actor,AppError,parse,uuid,text,version} from '../../../packages/domain/src/protocol';
import {checkPublishable} from '../../../packages/domain/src/publication-payload';
import {Production} from './production';
import {audit} from './commands';
export class Publications extends Production {
 async workItem(tx:Tx,a:Actor,cid:string,input:unknown){
  const b=parse(z.object({owner_id:uuid,reason:text(10000),expected_version:version}).strict(),input),c=await this.scope(tx,a,cid,true);
  if(c.business_status!=='published'||c.version!==b.expected_version)throw new AppError(409,'PUBLISHED_REQUIRED','仅当前已发布内容可新建修订工作项');
  const result=await this.create(tx,a,{account_id:c.account_id,media_type:'graphic',owner_id:b.owner_id,title:c.title});
  const base=(await tx.query('SELECT * FROM content_revisions WHERE id=$1',[c.approved_revision_id])).rows[0];
  const revision=await this.append(tx,a,result.data,base.payload,base.id,true);
  await tx.query('UPDATE content_revisions SET frozen=true WHERE id=$1',[result.data.current_revision_id]);
  const made=(await tx.query('UPDATE contents SET supersedes_content_id=$2,revision_reason=$3,current_revision_id=$4 WHERE id=$1 RETURNING *',[result.data.id,c.id,b.reason,revision.id])).rows[0];
  await audit(tx,a,'content.revision_work_item','content',made.id,{supersedes_content_id:c.id,reason:b.reason});return {status:201,data:made};
 }
 async publication(a:Actor,pid:string){
  const p=(await this.db.query('SELECT * FROM publications WHERE workspace_id=$1 AND id=$2',[a.workspaceId,parse(uuid,pid)])).rows[0];if(!p)throw new AppError(404,'NOT_FOUND','发布记录不存在');await this.scope(this.db,a,p.content_id);
  const revision=(await this.db.query('SELECT * FROM content_revisions WHERE id=$1',[p.current_revision_id])).rows[0];
  const deliverables=(await this.db.query('SELECT f.id,f.original_name,f.sha256,f.size_bytes,d.position FROM media_deliverables d JOIN file_objects f ON f.id=d.file_id WHERE d.revision_id=$1 ORDER BY position',[p.current_revision_id])).rows;
  return {...p,current_revision:revision,deliverables,changes:(await this.db.query('SELECT * FROM publication_changes WHERE publication_id=$1 ORDER BY created_at,id',[p.id])).rows};
 }
 async change(tx:Tx,a:Actor,pid:string,input:unknown){
  const common={evidence:text(10000),occurred_at:z.iso.datetime({offset:true}),expected_version:version};
  const b=parse(z.discriminatedUnion('kind',[z.object({...common,kind:z.literal('edited'),actual_revision_id:uuid}).strict(),z.object({...common,kind:z.literal('deleted')}).strict(),z.object({...common,kind:z.literal('reposted'),reposted_publication_id:uuid}).strict()]),input);
  const p=(await tx.query('SELECT * FROM publications WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[a.workspaceId,parse(uuid,pid)])).rows[0];if(!p)throw new AppError(404,'NOT_FOUND','发布记录不存在');await this.scope(tx,a,p.content_id);
  if(p.version!==b.expected_version||(b.kind!=='reposted'&&p.lifecycle!=='active'))throw new AppError(409,'PUBLICATION_CONFLICT','发布记录状态已变化');
  if(Date.parse(b.occurred_at)>Date.now()||Date.parse(b.occurred_at)<new Date(p.published_at).getTime())throw new AppError(422,'CHANGE_TIME_INVALID','变更时间须在实际发布之后且不在未来');
  let actualRevision:string|null=null,repostedPublication:string|null=null;
  if(b.kind==='edited'){
   const revision=(await tx.query('SELECT * FROM content_revisions WHERE workspace_id=$1 AND id=$2',[a.workspaceId,b.actual_revision_id])).rows[0];if(!revision)throw new AppError(404,'NOT_FOUND','修订版本不存在');
   const c=await this.scope(tx,a,revision.content_id,true);
   const lineage=(await tx.query('WITH RECURSIVE parents AS (SELECT id,supersedes_content_id FROM contents WHERE id=$1 UNION ALL SELECT c.id,c.supersedes_content_id FROM contents c JOIN parents p ON c.id=p.supersedes_content_id) SELECT id FROM parents WHERE id=$2',[c.id,p.content_id])).rowCount;
   if(c.id===p.content_id||!lineage||c.account_id!==p.account_id||c.business_status!=='ready_to_publish'||c.approved_revision_id!==revision.id||c.current_revision_id!==revision.id)throw new AppError(409,'APPROVED_WORK_ITEM_REQUIRED','外部编辑须关联本笔记重新批准的修订工作项');
   await checkPublishable(tx,a.workspaceId,revision);actualRevision=revision.id;
   await tx.query("UPDATE contents SET business_status='published',version=version+1,updated_at=now() WHERE id=$1",[c.id]);
  }else if(b.kind==='reposted'){
   const next=(await tx.query('SELECT * FROM publications WHERE workspace_id=$1 AND id=$2',[a.workspaceId,b.reposted_publication_id])).rows[0];
   if(!next||next.id===p.id||next.account_id!==p.account_id||next.platform_note_id===p.platform_note_id||next.lifecycle!=='active'||new Date(next.published_at).getTime()>Date.parse(b.occurred_at))throw new AppError(422,'REPOST_INVALID','重发须关联同账号已登记的新笔记ID');
   await this.scope(tx,a,next.content_id);repostedPublication=next.id;
   if((await tx.query("SELECT id FROM publication_changes WHERE publication_id=$1 AND reposted_publication_id=$2",[p.id,next.id])).rowCount)throw new AppError(409,'REPOST_ALREADY_RECORDED','该重发已记录');
  }
  const change=(await tx.query('INSERT INTO publication_changes(workspace_id,publication_id,kind,actual_revision_id,reposted_publication_id,evidence,occurred_at,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[a.workspaceId,p.id,b.kind,actualRevision,repostedPublication,b.evidence,b.occurred_at,a.memberId])).rows[0];
  await tx.query("UPDATE publications SET current_revision_id=COALESCE($2,current_revision_id),lifecycle=CASE WHEN $3='deleted' THEN 'deleted' ELSE lifecycle END,version=version+1,updated_at=now() WHERE id=$1",[p.id,actualRevision,b.kind]);
  await audit(tx,a,'publication.'+b.kind,'publication',p.id,{change_id:change.id,actual_revision_id:actualRevision,reposted_publication_id:repostedPublication});return {status:201,data:change};
 }
 async draft(tx:Tx,a:Actor,input:unknown){
  const b=parse(z.object({content_id:uuid,revision_id:uuid,partial_fields:z.record(z.string(),z.unknown()),verification_note:text(10000)}).strict(),input),c=await this.scope(tx,a,b.content_id,true);
  if(c.business_status!=='ready_to_publish'||c.approved_revision_id!==b.revision_id)throw new AppError(409,'APPROVED_REVISION_REQUIRED','暂存必须关联当前批准版本');
  const d=(await tx.query('INSERT INTO publication_drafts(workspace_id,content_id,revision_id,partial_fields,verification_note,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[a.workspaceId,c.id,b.revision_id,JSON.stringify(b.partial_fields),b.verification_note,a.memberId])).rows[0];await audit(tx,a,'publication.draft','publication_draft',d.id);return {status:201,data:d};
 }
 async register(tx:Tx,a:Actor,input:unknown){
  const b=parse(z.object({content_id:uuid,account_id:uuid,approved_revision_id:uuid,platform_note_id:text(200),url:z.url().max(2000).refine(s=>new URL(s).protocol==='https:'),published_at:z.iso.datetime({offset:true}),traffic_type:z.enum(['organic','paid','mixed','unknown']),is_campaign:z.boolean()}).strict(),input),c=await this.scope(tx,a,b.content_id,true);
  if(c.account_id!==b.account_id)throw new AppError(422,'ACCOUNT_MISMATCH','登记账号与内容账号不一致');
  if(c.business_status!=='ready_to_publish'||c.approved_revision_id!==b.approved_revision_id||c.current_revision_id!==b.approved_revision_id)throw new AppError(409,'APPROVED_REVISION_REQUIRED','须登记当前批准版本');
  if(Date.parse(b.published_at)>Date.now())throw new AppError(422,'PUBLICATION_TIME_INVALID','实际发布时间不能在未来');
  const revision=(await tx.query('SELECT * FROM content_revisions WHERE id=$1',[b.approved_revision_id])).rows[0];await checkPublishable(tx,a.workspaceId,revision);
  const p=(await tx.query('INSERT INTO publications(workspace_id,account_id,content_id,revision_id,current_revision_id,platform_note_id,url,published_at,recorded_by,traffic_type,is_campaign) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[a.workspaceId,c.account_id,c.id,revision.id,b.platform_note_id,b.url,b.published_at,a.memberId,b.traffic_type,b.is_campaign])).rows[0];
  await tx.query("UPDATE contents SET business_status='published',version=version+1,updated_at=now() WHERE id=$1",[c.id]);
  // S6/S7 consume this durable business event; it is not an executable worker job.
  await tx.query("INSERT INTO outbox(workspace_id,account_id,event_key,event_type,payload) VALUES($1,$2,$3,'publication.recorded',$4)",[a.workspaceId,c.account_id,'publication:'+p.id,JSON.stringify({publication_id:p.id,content_id:c.id,revision_id:revision.id,published_at:b.published_at,created_by:a.memberId,request_id:a.requestId})]);
  await audit(tx,a,'publication.register','publication',p.id,{content_id:c.id,revision_id:revision.id});return {status:201,data:p};
 }
}
