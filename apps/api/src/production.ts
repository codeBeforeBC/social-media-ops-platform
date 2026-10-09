import {z} from 'zod';
import {Tx} from '../../../packages/db/src/db';
import {Actor,AppError,parse,uuid,version,text,id,sha,canonical,pagination,page} from '../../../packages/domain/src/protocol';
import {saveRevisionAssetUsages} from '../../../packages/domain/src/briefs';
import {checkPublishable} from '../../../packages/domain/src/publication-payload';
import {exportGuard} from '../../../packages/domain/src/export-package';
import {Files} from './files';
import {Contents} from './contents';
import {Commands,audit} from './commands';
const graphicPage=z.object({position:z.number().int().min(1),visual_instruction:z.string().max(10000),page_copy:z.string().max(10000),asset_version_ids:z.array(uuid).max(100),publish_file_id:uuid.nullable()}).strict();
const graphicFields={title:text(),body:z.string().max(10000),tags:z.array(text(100)).max(100),brief:z.record(z.string(),z.unknown()),pages:z.array(graphicPage).max(30)};
export class Production extends Contents {
 async list(a:Actor,q:Record<string,unknown>){
  const {limit,cursor}=pagination(q),account=q.account_id?parse(uuid,q.account_id):null,owner=q.owner_id?parse(uuid,q.owner_id):null;
  const state=q.status?parse(z.enum(['draft','in_production','in_review','ready_to_publish','published','cancelled']),q.status):null;
  const kind=q.media_type?parse(z.enum(['graphic','video']),q.media_type):null,start=q.planned_start?parse(z.iso.datetime({offset:true}),q.planned_start):null,end=q.planned_end?parse(z.iso.datetime({offset:true}),q.planned_end):null;
  if(start&&end&&new Date(start)>=new Date(end))throw new AppError(422,'TIME_RANGE_INVALID','结束须晚于开始');
  if(account)await new Commands(this.db).accountScope(this.db,a,account);
  const r=await this.db.query(`SELECT c.* FROM contents c WHERE c.workspace_id=$1 AND ($2::boolean OR EXISTS(SELECT 1 FROM account_memberships am WHERE am.account_id=c.account_id AND am.membership_id=$3)) AND ($4::uuid IS NULL OR c.account_id=$4) AND ($5::text IS NULL OR c.business_status=$5) AND ($6::text IS NULL OR c.media_type=$6) AND ($7::uuid IS NULL OR c.owner_id=$7) AND ($8::timestamptz IS NULL OR c.planned_publish_at>=$8) AND ($9::timestamptz IS NULL OR c.planned_publish_at<$9) AND ($10::timestamptz IS NULL OR (c.created_at,c.id)<($10,$11::uuid)) ORDER BY c.created_at DESC,c.id DESC LIMIT $12`,[a.workspaceId,a.roles.includes('admin'),a.memberId,account,state,kind,owner,start,end,cursor?.at??null,cursor?.id??null,limit+1]);return page(r.rows,limit);
 }
 async metadata(tx:Tx,a:Actor,cid:string,input:unknown){
  const b=parse(z.object({expected_version:version,internal_notes:z.string().max(10000).optional(),planned_publish_at:z.iso.datetime({offset:true}).nullable().optional(),estimated_hours:z.number().min(0).max(10000).nullable().optional()}).strict(),input),c=await this.scope(tx,a,cid,true);
  if(c.version!==b.expected_version)throw new AppError(409,'VERSION_CONFLICT','内容已修改',{version:c.version});
  const r=(await tx.query('UPDATE contents SET internal_notes=$2,planned_publish_at=$3,estimated_hours=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[c.id,b.internal_notes??c.internal_notes,b.planned_publish_at===undefined?c.planned_publish_at:b.planned_publish_at,b.estimated_hours===undefined?c.estimated_hours:b.estimated_hours])).rows[0];
  await audit(tx,a,'content.metadata','content',c.id,{fields:Object.keys(b).filter(k=>k!=='expected_version')});return {status:200,data:r};
 }
 async detail(a:Actor,cid:string){
  const c=await super.detail(a,cid);
  const deliverables=(await this.db.query('SELECT f.id,f.original_name,f.sha256,f.size_bytes,f.file_status,f.preview_status,d.position,d.role FROM media_deliverables d JOIN file_objects f ON f.id=d.file_id WHERE d.revision_id=$1 ORDER BY d.position',[c.current_revision_id])).rows;
  const asset_references=(await this.db.query('SELECT u.revision_id,u.asset_version_id,u.usage_role,v.version_no,v.permission_confirmed_at,v.valid_until,v.usage_scope,a.name,a.business_status FROM asset_usages u JOIN asset_versions v ON v.id=u.asset_version_id JOIN assets a ON a.id=v.asset_id JOIN content_revisions r ON r.id=u.revision_id WHERE r.content_id=$1 ORDER BY r.revision_no,u.usage_role',[c.id])).rows;
  return {...c,deliverables,asset_references,reviews:(await this.db.query('SELECT * FROM reviews WHERE content_id=$1 ORDER BY created_at DESC,id DESC',[c.id])).rows};
 }
 async create(tx:Tx,a:Actor,input:unknown){
  const b=parse(z.object({account_id:uuid,media_type:z.literal('graphic'),owner_id:uuid,title:text()}).strict(),input);
  await new Commands(this.db).accountScope(tx,a,b.account_id);
  if(!a.roles.includes('admin')&&b.owner_id!==a.memberId)throw new AppError(403,'FIELD_FORBIDDEN','编辑只能创建本人任务');
  if(!(await tx.query('SELECT id FROM memberships WHERE workspace_id=$1 AND id=$2 AND active FOR SHARE',[a.workspaceId,b.owner_id])).rowCount)throw new AppError(422,'OWNER_INVALID','负责人不存在或已停用');
  const c=(await tx.query('INSERT INTO contents(workspace_id,account_id,created_by,title,media_type,owner_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[a.workspaceId,b.account_id,a.memberId,b.title,b.media_type,b.owner_id])).rows[0];
  const revision=await this.append(tx,a,c,{title:b.title,body:'',tags:[],brief:{},pages:[]},null);
  await tx.query('UPDATE contents SET current_revision_id=$2 WHERE id=$1',[c.id,revision.id]);await audit(tx,a,'content.create','content',c.id);
  return {status:201,data:{...c,current_revision_id:revision.id}};
 }
 async append(tx:Tx,a:Actor,c:any,payload:any,baseId:string|null,copyInherited=false){
  const revision=id(),next=(await tx.query('SELECT COALESCE(max(revision_no),0)+1 n FROM content_revisions WHERE content_id=$1',[c.id])).rows[0].n;
  const r=(await tx.query('INSERT INTO content_revisions(id,workspace_id,content_id,created_by,revision_no,payload,base_revision_id,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[revision,a.workspaceId,c.id,a.memberId,next,JSON.stringify(payload),baseId,sha(canonical(payload))])).rows[0];
  if(copyInherited&&baseId)await tx.query('INSERT INTO asset_usages(workspace_id,created_by,asset_version_id,revision_id,usage_role,permission_snapshot) SELECT workspace_id,$3,asset_version_id,$2,usage_role,permission_snapshot FROM asset_usages WHERE revision_id=$1',[baseId,revision,a.memberId]);
  else await saveRevisionAssetUsages(tx,a.workspaceId,a.memberId,revision,payload);
  for(const page of payload.pages??[]){if(!page.publish_file_id)continue;
   const f=(await tx.query('SELECT * FROM file_objects WHERE workspace_id=$1 AND id=$2 AND NOT is_preview FOR SHARE',[a.workspaceId,page.publish_file_id])).rows[0];
   if(!f||f.file_status!=='ready'||f.detected_mime!=='image/png')throw new AppError(422,'PUBLISH_IMAGE_INVALID','发布图片必须为本空间可用PNG原件');
   await tx.query("INSERT INTO media_deliverables(workspace_id,revision_id,file_id,role,position) VALUES($1,$2,$3,'publish_image',$4)",[a.workspaceId,revision,page.publish_file_id,page.position]);
  }
  return r;
 }
 async check(tx:Tx,a:Actor,cid:string,input:unknown){
  const b=parse(z.object({revision_id:uuid}).strict(),input),c=await this.scope(tx,a,cid);
  if(c.current_revision_id!==b.revision_id)throw new AppError(409,'VERSION_CONFLICT','请选择当前版本执行辅助检查');
  const revision=(await tx.query('SELECT * FROM content_revisions WHERE id=$1',[b.revision_id])).rows[0];
  const ruleSet=(await tx.query("SELECT id,edition,version,source_file_id FROM rule_sets WHERE workspace_id=$1 AND status='active'",[a.workspaceId])).rows[0]??null;
  const rules=ruleSet?(await tx.query('SELECT id,category,rule_text,source_page,severity,uncertainty_note FROM brand_rules WHERE rule_set_id=$1 ORDER BY source_page,id',[ruleSet.id])).rows:[];
  const suggestions=rules.map(r=>({...r,message:'请人工核对：'+r.rule_text,rule_set_id:ruleSet.id,rule_set_version:ruleSet.version}));
  if(!ruleSet)suggestions.push({message:'未启用品牌规范，请人工核对品牌使用范围。'});
  if(!(revision.payload.tags??[]).length)suggestions.push({message:'尚未填写标签，可按发布场景补充。'});
  await audit(tx,a,'content.advisory_check','content',c.id,{revision_id:revision.id,rule_set_id:ruleSet?.id??null});
  return {status:200,data:{advisory_only:true,revision_id:revision.id,payload_hash:revision.payload_hash,rule_set:ruleSet,suggestions}};
 }
 async exportPackage(tx:Tx,a:Actor,cid:string,input:unknown){
  const b=parse(z.object({approved_revision_id:uuid}).strict(),input),c=await this.scope(tx,a,cid,true);
  if(c.business_status!=='ready_to_publish'||c.approved_revision_id!==b.approved_revision_id||c.current_revision_id!==b.approved_revision_id)throw new AppError(409,'APPROVED_REVISION_REQUIRED','仅能导出当前批准版本');
  const r=(await tx.query('SELECT * FROM content_revisions WHERE id=$1',[b.approved_revision_id])).rows[0];await checkPublishable(tx,a.workspaceId,r);
  let e=(await tx.query('SELECT e.*,j.state job_state FROM export_packages e LEFT JOIN jobs j ON j.id=e.job_id WHERE e.content_id=$1 AND e.revision_id=$2',[c.id,r.id])).rows[0];
  if(!e){e=(await tx.query('INSERT INTO export_packages(workspace_id,account_id,content_id,revision_id,payload_hash,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[a.workspaceId,c.account_id,c.id,r.id,r.payload_hash,a.memberId])).rows[0];
  }
  if(!e.job_id||e.job_state==='cancelled'){
   const out=(await tx.query("INSERT INTO outbox(workspace_id,account_id,event_key,event_type,payload) VALUES($1,$2,$3,'content.export',$4) RETURNING id",[a.workspaceId,c.account_id,'export:'+e.id+':'+id(),JSON.stringify({created_by:a.memberId,request_id:a.requestId,pool:'general',input:{export_package_id:e.id}})])).rows[0];
   const job=(await tx.query("INSERT INTO jobs(workspace_id,account_id,created_by,outbox_id,type,pool,input,request_id) VALUES($1,$2,$3,$4,'content.export','general',$5,$6) RETURNING id",[a.workspaceId,c.account_id,a.memberId,out.id,JSON.stringify({export_package_id:e.id}),a.requestId])).rows[0];await tx.query('UPDATE export_packages SET job_id=$2 WHERE id=$1',[e.id,job.id]);e.job_id=job.id;
  }
  await audit(tx,a,'content.export_package','content',c.id,{export_package_id:e.id,revision_id:r.id});return {status:202,data:{id:e.id,job_id:e.job_id,status_url:'/api/v1/export-packages/'+e.id}};
 }
 async packageDetail(a:Actor,eid:string){
  const e=(await this.db.query('SELECT e.*,j.state job_state,j.error_code FROM export_packages e JOIN jobs j ON j.id=e.job_id WHERE e.workspace_id=$1 AND e.id=$2',[a.workspaceId,parse(uuid,eid)])).rows[0];if(!e)throw new AppError(404,'NOT_FOUND','发布包不存在');await this.scope(this.db,a,e.content_id);return {...e,state:e.file_id?'ready':e.job_state};
 }
 async packageDownload(a:Actor,eid:string){
  const e=await this.packageDetail(a,eid);if(!e.file_id)throw new AppError(409,'EXPORT_NOT_READY','发布包尚未完成');
  try{await this.db.transaction(tx=>exportGuard(tx,a.workspaceId,e.id));}catch{throw new AppError(409,'EXPORT_STALE','批准或素材状态已变化，不能下载旧发布包');}
  return new Files(this.db).link(a,e.file_id);
 }
 async start(tx:Tx,a:Actor,cid:string,input:unknown){
  const b=parse(z.object({expected_version:version,estimated_hours:z.number().min(0).max(10000)}).strict(),input),c=await this.scope(tx,a,cid,true);
  if(c.version!==b.expected_version||c.business_status!=='draft')throw new AppError(409,'VERSION_CONFLICT','仅当前草稿可开始制作');
  const r=(await tx.query("UPDATE contents SET business_status='in_production',estimated_hours=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",[c.id,b.estimated_hours])).rows[0];await audit(tx,a,'content.start_production','content',c.id,{estimated_hours:b.estimated_hours});return {status:200,data:r};
 }
 async cancel(tx:Tx,a:Actor,cid:string,input:unknown){
  const b=parse(z.object({expected_version:version,reason:text(10000)}).strict(),input),c=await this.scope(tx,a,cid,true);
  if(c.version!==b.expected_version||['published','cancelled'].includes(c.business_status))throw new AppError(409,'VERSION_CONFLICT','当前版本不能取消');
  await tx.query("UPDATE reviews SET status='withdrawn',comment=$2,decided_at=now(),version=version+1 WHERE content_id=$1 AND status='pending'",[c.id,b.reason]);
  await tx.query("UPDATE ai_requests SET state='cancelled',error_code='CANCELLED',finished_at=now() WHERE workspace_id=$1 AND snapshot->>'content_id'=$2 AND state IN ('queued','running')",[a.workspaceId,c.id]);
  await tx.query("UPDATE jobs SET state='cancelled',cancel_requested=true,lease_token=NULL,lease_until=NULL,finished_at=now(),error_code='CANCELLED',version=version+1 WHERE workspace_id=$1 AND state IN ('queued','running') AND input->>'ai_request_id' IN (SELECT id::text FROM ai_requests WHERE workspace_id=$1 AND snapshot->>'content_id'=$2)",[a.workspaceId,c.id]);
  await tx.query("UPDATE outbox SET dispatched_at=now() WHERE workspace_id=$1 AND dispatched_at IS NULL AND payload->'input'->>'ai_request_id' IN (SELECT id::text FROM ai_requests WHERE workspace_id=$1 AND snapshot->>'content_id'=$2)",[a.workspaceId,c.id]);
  await tx.query("UPDATE jobs SET state='cancelled',cancel_requested=true,lease_token=NULL,lease_until=NULL,finished_at=now(),error_code='CANCELLED',version=version+1 WHERE workspace_id=$1 AND state IN ('queued','running') AND input->>'export_package_id' IN (SELECT id::text FROM export_packages WHERE content_id=$2)",[a.workspaceId,c.id]);
  await tx.query("UPDATE outbox SET dispatched_at=now() WHERE workspace_id=$1 AND dispatched_at IS NULL AND payload->'input'->>'export_package_id' IN (SELECT id::text FROM export_packages WHERE content_id=$2)",[a.workspaceId,c.id]);
  const r=(await tx.query("UPDATE contents SET business_status='cancelled',approved_revision_id=NULL,cancellation_reason=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",[c.id,b.reason])).rows[0];await audit(tx,a,'content.cancel','content',c.id,{reason:b.reason});return {status:200,data:r};
 }
 async submit(tx:Tx,a:Actor,cid:string,input:unknown){
  const b=parse(z.object({revision_id:uuid,expected_version:version}).strict(),input),c=await this.scope(tx,a,cid,true);
  if(c.media_type!=='graphic'||!['draft','in_production'].includes(c.business_status))throw new AppError(409,'CONTENT_NOT_EDITABLE','当前状态不能提交图文审核');
  if(c.version!==b.expected_version||c.current_revision_id!==b.revision_id)throw new AppError(409,'VERSION_CONFLICT','内容已修改，请重新核对版本');
  const r=(await tx.query("SELECT * FROM content_revisions WHERE id=$1 AND content_id=$2 AND origin<>'ai_candidate'",[b.revision_id,c.id])).rows[0];
  if(!r)throw new AppError(422,'REVISION_INVALID','须提交当前人工确认版本');await checkPublishable(tx,a.workspaceId,r);
  await tx.query('UPDATE content_revisions SET frozen=true WHERE id=$1 AND NOT frozen',[r.id]);
  const review=(await tx.query('INSERT INTO reviews(workspace_id,content_id,revision_id,payload_hash,requester_id) VALUES($1,$2,$3,$4,$5) RETURNING *',[a.workspaceId,c.id,r.id,r.payload_hash,a.memberId])).rows[0];
  await tx.query("UPDATE contents SET business_status='in_review',version=version+1,updated_at=now() WHERE id=$1",[c.id]);await audit(tx,a,'content.submit_review','content',c.id,{review_id:review.id,revision_id:r.id});return {status:201,data:review};
 }
 async decide(tx:Tx,a:Actor,rid:string,input:unknown){
  const b=parse(z.object({decision:z.enum(['approve','reject']),checklist:z.array(text(1000)).min(1).max(100),comment:z.string().max(10000),revision_id:uuid,expected_version:version}).strict(),input);
  const {c,r}=await this.reviewScope(tx,a,rid);if(r.version!==b.expected_version||r.status!=='pending'||c.business_status!=='in_review'||c.current_revision_id!==r.revision_id||b.revision_id!==r.revision_id)throw new AppError(409,'REVIEW_STALE','审核状态或版本已变化');
  if(b.decision==='reject'&&!b.comment.trim())throw new AppError(422,'REASON_REQUIRED','退回必须填写意见');
  const revision=(await tx.query('SELECT * FROM content_revisions WHERE id=$1',[r.revision_id])).rows[0];
  if(!revision.frozen||r.payload_hash!==revision.payload_hash)throw new AppError(409,'REVIEW_STALE','冻结版本与审核哈希不一致');
  if(b.decision==='approve')await checkPublishable(tx,a.workspaceId,revision);
  const reviewed=(await tx.query('UPDATE reviews SET status=$2,reviewer_id=$3,checklist=$4,comment=$5,decided_at=now(),version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[r.id,b.decision==='approve'?'approved':'rejected',a.memberId,JSON.stringify(b.checklist),b.comment])).rows[0];
  if(b.decision==='approve')await tx.query("UPDATE contents SET business_status='ready_to_publish',approved_revision_id=$2,version=version+1,updated_at=now() WHERE id=$1",[c.id,r.revision_id]);
  else await this.returnToProduction(tx,a,c,revision);
  await audit(tx,a,'review.'+b.decision,'review',r.id,{revision_id:r.revision_id});return {status:200,data:reviewed};
 }
 async withdraw(tx:Tx,a:Actor,rid:string,input:unknown){
  const b=parse(z.object({reason:text(10000),expected_version:version}).strict(),input),{c,r}=await this.reviewScope(tx,a,rid);
  if(!a.roles.includes('admin')&&r.requester_id!==a.memberId)throw new AppError(403,'FORBIDDEN','只能撤回本人提交的审核');
  if(r.version!==b.expected_version||r.status!=='pending'||c.business_status!=='in_review'||c.current_revision_id!==r.revision_id)throw new AppError(409,'REVIEW_STALE','审核已处理或版本已变化');
  const withdrawn=(await tx.query("UPDATE reviews SET status='withdrawn',comment=$2,decided_at=now(),version=version+1,updated_at=now() WHERE id=$1 RETURNING *",[r.id,b.reason])).rows[0];
  const revision=(await tx.query('SELECT * FROM content_revisions WHERE id=$1',[r.revision_id])).rows[0];await this.returnToProduction(tx,a,c,revision);await audit(tx,a,'review.withdraw','review',r.id,{reason:b.reason});return {status:200,data:withdrawn};
 }
 async reviewScope(tx:Tx,a:Actor,rid:string){
  const first=(await tx.query('SELECT * FROM reviews WHERE workspace_id=$1 AND id=$2',[a.workspaceId,parse(uuid,rid)])).rows[0];if(!first)throw new AppError(404,'NOT_FOUND','审核请求不存在');
  const c=await this.scope(tx,a,first.content_id,true),r=(await tx.query('SELECT * FROM reviews WHERE id=$1 FOR UPDATE',[first.id])).rows[0];return {c,r};
 }
 async returnToProduction(tx:Tx,a:Actor,c:any,revision:any){
  const next=await this.append(tx,a,c,revision.payload,revision.id,true);
  await tx.query("UPDATE contents SET business_status='in_production',current_revision_id=$2,approved_revision_id=NULL,version=version+1,updated_at=now() WHERE id=$1",[c.id,next.id]);
 }
 async restore(tx:Tx,a:Actor,cid:string,input:unknown){
  const b=parse(z.object({source_revision_id:uuid,base_revision_id:uuid,expected_version:version}).strict(),input),c=await this.scope(tx,a,cid,true);
  const source=(await tx.query("SELECT * FROM content_revisions WHERE workspace_id=$1 AND content_id=$2 AND id=$3 AND origin<>'ai_candidate'",[a.workspaceId,c.id,b.source_revision_id])).rows[0];
  if(!source)throw new AppError(404,'NOT_FOUND','历史草稿不存在');
  return this.save(tx,a,cid,{base_revision_id:b.base_revision_id,expected_version:b.expected_version,title:source.payload.title,body:source.payload.body??'',tags:source.payload.tags??[],brief:source.payload.brief??{},pages:source.payload.pages??[]});
 }
 async save(tx:Tx,a:Actor,cid:string,input:unknown){
  const b=parse(z.object({base_revision_id:uuid,expected_version:version,...graphicFields}).strict(),input),c=await this.scope(tx,a,cid,true);
  if(c.media_type!=='graphic')throw new AppError(422,'GRAPHIC_REQUIRED','当前仅支持图文编辑');
  if(!['draft','in_production','ready_to_publish'].includes(c.business_status))throw new AppError(409,'CONTENT_NOT_EDITABLE','当前状态不能保存，请先撤回或新建修订');
  if(c.version!==b.expected_version||c.current_revision_id!==b.base_revision_id)throw new AppError(409,'VERSION_CONFLICT','内容已修改，请比较当前版本',{version:c.version});
  if(b.pages.some((p,i)=>p.position!==i+1))throw new AppError(422,'PAGE_ORDER_INVALID','页序须从1连续排列');
  const base=(await tx.query('SELECT * FROM content_revisions WHERE id=$1 AND content_id=$2',[b.base_revision_id,c.id])).rows[0];
  if(!a.roles.some(r=>['admin','editor'].includes(r))&&(canonical(b.pages)!==canonical(base.payload.pages??[])||canonical(b.brief)!==canonical(base.payload.brief??{})))throw new AppError(403,'FIELD_FORBIDDEN','运营只能编辑标题、正文和标签');
  const payload={...base.payload,title:b.title,body:b.body,tags:b.tags,brief:b.brief,pages:b.pages};
  const revision=await this.append(tx,a,c,payload,base.id);
  await tx.query('UPDATE content_revisions SET frozen=true WHERE id=$1 AND NOT frozen',[base.id]);
  const updated=(await tx.query("UPDATE contents SET current_revision_id=$2,title=$3,business_status=CASE WHEN business_status='ready_to_publish' THEN 'in_production' ELSE business_status END,approved_revision_id=NULL,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",[c.id,revision.id,b.title])).rows[0];
  await audit(tx,a,'content.save_revision','content',c.id,{revision_id:revision.id,base_revision_id:base.id});return {status:201,data:{...updated,current_revision:revision}};
 }
}
