import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Database,Tx} from '../../../packages/db/src/db';
import {Storage,storageError} from '../../../packages/domain/src/storage';
import {Actor,AppError,authorize,parse,text,uuid} from '../../../packages/domain/src/protocol';
import {Commands,audit} from './commands';
export const PART_SIZE=8388608;
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export class Files {
 readonly storage=new Storage();readonly commands:Commands;
 constructor(readonly db:Database){this.commands=new Commands(db);}
 async scope(q:Pick<Database,'query'>|Tx,a:Actor,uploadId:string,lock=false){
  parse(uuid,uploadId);const r=await q.query(`SELECT * FROM upload_sessions WHERE id=$1 AND workspace_id=$2 AND (created_by=$3 OR $4) ${lock?'FOR UPDATE':''}`,[uploadId,a.workspaceId,a.memberId,a.roles.includes('admin')]);
  if(!r.rowCount)throw new AppError(404,'NOT_FOUND','上传不存在或不可见');return r.rows[0];
 }
 active(u:Record<string,any>){if(!['created','uploading'].includes(u.status))throw new AppError(409,'UPLOAD_CLOSED','上传会话已结束');if(new Date(u.expires_at).getTime()<=Date.now())throw new AppError(409,'UPLOAD_EXPIRED','上传会话已过期');}
 safe(u:Record<string,any>){const {storage_upload_id,object_key,parts,...rest}=u;return {...rest,size_bytes:Number(u.size_bytes),completed_parts:Object.entries(parts).filter(([,p])=>(p as any).etag).map(([n,p])=>({part_number:Number(n),...(p as object)})),part_size:PART_SIZE,max_size_bytes:2147483648};}
 async create(tx:Tx,a:Actor,input:unknown){
  const b=parse(z.object({name:text(),size_bytes:z.number().int().min(1).max(2147483648),mime_hint:text().refine(s=>['image/png','application/pdf','application/octet-stream'].includes(s)),sha256:hash.optional(),purpose:z.enum(['asset','guideline'])}).strict(),input);
  if((b.purpose==='asset'&&b.mime_hint==='application/pdf')||(b.purpose==='guideline'&&b.mime_hint==='image/png'))throw new AppError(422,'MIME_TYPE_INVALID','文件MIME提示与用途不一致');
  if(/[\/\\\r\n]/.test(b.name))throw new AppError(422,'FILE_NAME_INVALID','文件名不能包含路径或换行');
  if((b.purpose==='asset'&&!/\.png$/i.test(b.name))||(b.purpose==='guideline'&&!/\.pdf$/i.test(b.name)))throw new AppError(422,'FILE_TYPE_UNSUPPORTED','本版素材仅支持PNG，规范仅支持PDF');
  const key=`${a.workspaceId}/originals/${randomUUID()}`;
  try{
   const uploadId=await this.storage.create(key);
   try{const r=await tx.query('INSERT INTO upload_sessions(workspace_id,created_by,original_name,size_bytes,mime_hint,purpose,sha256,object_key,storage_upload_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[a.workspaceId,a.memberId,b.name,b.size_bytes,b.mime_hint,b.purpose,b.sha256??null,key,uploadId]);await audit(tx,a,'upload.create','upload',r.rows[0].id);return {status:201,data:this.safe(r.rows[0])};}
   catch(e){await this.storage.abort(key,uploadId);throw e;}
  }catch(e){storageError(e);}
 }
 async get(a:Actor,uploadId:string){return this.safe(await this.scope(this.db,a,uploadId));}
 async register(tx:Tx,a:Actor,uploadId:string,input:unknown){
  const b=parse(z.object({part_number:z.number().int().positive(),checksum:hash}).strict(),input);const u=await this.scope(tx,a,uploadId,true);this.active(u);
  if(b.part_number>Math.ceil(Number(u.size_bytes)/PART_SIZE))throw new AppError(422,'PART_INVALID','分片编号超出范围');
  const old=u.parts[b.part_number];if(old&&old.checksum!==b.checksum)throw new AppError(409,'PART_CONFLICT','已登记分片的校验值不同');
  if(!old){u.parts[b.part_number]={checksum:b.checksum};await tx.query("UPDATE upload_sessions SET parts=$1,status='uploading',updated_at=now(),version=version+1 WHERE id=$2",[JSON.stringify(u.parts),u.id]);}
  return {status:200,data:{part_number:b.part_number,checksum:b.checksum,etag:old?.etag??null,upload_url:`/api/v1/uploads/${u.id}/parts/${b.part_number}`,method:'PUT'}};
 }
 async put(a:Actor,uploadId:string,n:number,body:Buffer){
  authorize(a,'asset.edit');if(!Buffer.isBuffer(body))throw new AppError(422,'PART_INVALID','需要二进制分片');
  return this.db.transaction(async tx=>{
   const {reloadActor}=await import('./auth');authorize(await reloadActor(tx,a),'asset.edit');
   const u=await this.scope(tx,a,uploadId,true);this.active(u);const p=u.parts[n];
   if(!p)throw new AppError(422,'PART_UNREGISTERED','请先登记分片校验值');
   const expected=Math.min(PART_SIZE,Number(u.size_bytes)-(n-1)*PART_SIZE);
   if(body.length!==expected||createHash('sha256').update(body).digest('hex')!==p.checksum)throw new AppError(422,'PART_CHECKSUM_INVALID','分片大小或校验值不一致');
   if(!p.etag){try{p.etag=await this.storage.part(u.object_key,u.storage_upload_id,n,body);}catch(e){storageError(e);}
    await tx.query('UPDATE upload_sessions SET parts=$1,updated_at=now(),version=version+1 WHERE id=$2',[JSON.stringify(u.parts),u.id]);}
   return {part_number:n,etag:p.etag,checksum:p.checksum};
  });
 }
 async finish(tx:Tx,a:Actor,uploadId:string,input:unknown){
  const b=parse(z.object({parts_manifest:z.array(z.object({part_number:z.number().int().positive(),etag:text(),checksum:hash}).strict()).min(1).max(256)}).strict(),input);
  const u=await this.scope(tx,a,uploadId,true);
  if(u.status==='completed')return {status:200,data:await this.file(tx,a,u.file_id)};this.active(u);
  const parts=[...b.parts_manifest].sort((x,y)=>x.part_number-y.part_number);
  if(parts.length!==Math.ceil(Number(u.size_bytes)/PART_SIZE)||parts.some((p,i)=>p.part_number!==i+1||u.parts[p.part_number]?.etag!==p.etag||u.parts[p.part_number]?.checksum!==p.checksum))throw new AppError(422,'PART_MANIFEST_INVALID','分片列表不完整或与服务器记录不同');
  try{
   await this.storage.complete(u.object_key,u.storage_upload_id,parts);
   const object=await this.storage.get(u.object_key);const digest=createHash('sha256');let size=0;let head=Buffer.alloc(0);
   for await(const chunk of object.Body as any){size+=chunk.length;if(size>Number(u.size_bytes)){(object.Body as any).destroy();throw new AppError(422,'FILE_SIZE_INVALID','原件大小不一致');}digest.update(chunk);if(head.length<512)head=Buffer.concat([head,chunk]).subarray(0,512);}
   const checksum=digest.digest('hex');
   if(size!==Number(u.size_bytes)||(u.sha256&&u.sha256!==checksum))throw new AppError(422,'FILE_CHECKSUM_INVALID','原件大小或哈希不一致');
   const mime=detectMime(head,u.original_name);if((u.purpose==='asset'&&mime!=='image/png')||(u.purpose==='guideline'&&mime!=='application/pdf'))throw new AppError(422,'FILE_TYPE_INVALID','文件内容与支持格式不一致');
   const existing=await tx.query('SELECT * FROM file_objects WHERE workspace_id=$1 AND sha256=$2 AND is_preview=false',[a.workspaceId,checksum]);let f;
   if(existing.rowCount){f=existing.rows[0];await this.storage.remove(u.object_key);}
   else{const r=await tx.query("INSERT INTO file_objects(workspace_id,created_by,upload_session_id,object_key,original_name,size_bytes,sha256,detected_mime,preview_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'not_requested') ON CONFLICT(workspace_id,sha256,is_preview) DO UPDATE SET sha256=EXCLUDED.sha256 RETURNING *",[a.workspaceId,a.memberId,u.id,u.object_key,u.original_name,size,checksum,mime]);f=r.rows[0];
    if(f.object_key!==u.object_key)await this.storage.remove(u.object_key);
    await tx.query("INSERT INTO outbox(workspace_id,event_key,event_type,payload) VALUES($1,$2,'media.preview',$3) ON CONFLICT DO NOTHING",[a.workspaceId,'file:'+f.id,JSON.stringify({pool:'media',created_by:a.memberId,input:{file_id:f.id},request_id:a.requestId})]);
   }
   await tx.query("UPDATE upload_sessions SET status='completed',file_id=$1,updated_at=now(),version=version+1 WHERE id=$2",[f.id,u.id]);await audit(tx,a,'upload.complete','file',f.id,{size_bytes:size,sha256:checksum});return {status:200,data:safeFile(f)};
  }catch(e){storageError(e);}
 }
 async abort(tx:Tx,a:Actor,uploadId:string,input:unknown){
  parse(z.object({reason:text(1000).optional()}).strict(),input);const u=await this.scope(tx,a,uploadId,true);
  if(u.status==='completed')throw new AppError(409,'UPLOAD_COMPLETED','已完成原件按引用策略保留');
  try{await this.storage.abort(u.object_key,u.storage_upload_id);await this.storage.remove(u.object_key);}catch(e){storageError(e);}
  const r=await tx.query("UPDATE upload_sessions SET status='aborted',parts='{}',updated_at=now(),version=version+1 WHERE id=$1 RETURNING *",[u.id]);await audit(tx,a,'upload.abort','upload',u.id);return {status:200,data:this.safe(r.rows[0])};
 }
 async file(q:Pick<Database,'query'>|Tx,a:Actor,fileId:string){parse(uuid,fileId);const r=await q.query('SELECT * FROM file_objects WHERE id=$1 AND workspace_id=$2',[fileId,a.workspaceId]);if(!r.rowCount)throw new AppError(404,'NOT_FOUND','文件不存在或不可见');return safeFile(r.rows[0]);}
 async link(a:Actor,fileId:string,preview=false,pageNumber?:number){
  if(!preview)authorize(a,'download.original');
  const r=await this.db.query('SELECT * FROM file_objects WHERE id=$1 AND workspace_id=$2',[parse(uuid,fileId),a.workspaceId]);
  if(!r.rowCount)throw new AppError(404,'NOT_FOUND','文件不存在或不可见');let f=r.rows[0];
  if(f.file_status!=='ready')throw new AppError(409,'FILE_NOT_READY','文件尚不可用');
  if(preview&&!f.is_preview){if(pageNumber!==undefined){if(!Number.isInteger(pageNumber)||pageNumber<1)throw new AppError(422,'PAGE_INVALID','页码无效');const page=f.metadata.pages_preview?.find((p:any)=>p.page===pageNumber);if(!page)throw new AppError(404,'PAGE_NOT_FOUND','页面预览不可用');f.preview_file_id=page.file_id;}if(!f.preview_file_id)throw new AppError(409,'PREVIEW_UNAVAILABLE','预览未就绪，请查看处理状态或由有权限成员下载原件');const p=await this.db.query('SELECT * FROM file_objects WHERE id=$1 AND workspace_id=$2',[f.preview_file_id,a.workspaceId]);f=p.rows[0];}
  try{return {...await this.storage.signed(f.object_key,f.original_name,f.detected_mime,preview),file_id:fileId};}catch(e){storageError(e);}
 }
 async expire(){
  const rows=await this.db.query("SELECT id,workspace_id FROM upload_sessions WHERE status IN ('created','uploading') AND expires_at<=now() LIMIT 20");
  for(const row of rows.rows)await this.db.transaction(async tx=>{const r=await tx.query("SELECT * FROM upload_sessions WHERE id=$1 AND status IN ('created','uploading') AND expires_at<=now() FOR UPDATE",[row.id]);if(!r.rowCount)return;const u=r.rows[0];await this.storage.abort(u.object_key,u.storage_upload_id);await this.storage.remove(u.object_key);await tx.query("UPDATE upload_sessions SET status='expired',parts='{}',version=version+1 WHERE id=$1",[u.id]);});
 }
}
export function safeFile(f:Record<string,any>):Record<string,any>{const {object_key,...rest}=f;return {...rest,size_bytes:Number(f.size_bytes)};}
export function detectMime(h:Buffer,name:string){
 if(h.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
 if(h.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(h[0]===255&&h[1]===216&&h[2]===255)return 'image/jpeg';
 if(h.subarray(0,4).toString()==='RIFF'&&h.subarray(8,12).toString()==='WEBP')return 'image/webp';
 if(h.subarray(0,3).toString()==='GIF')return 'image/gif';
 if(h.subarray(0,4).toString()==='RIFF'&&h.subarray(8,12).toString()==='WAVE')return 'audio/wav';
 if(h.subarray(4,8).toString()==='ftyp')return /\.m4a$/i.test(name)?'audio/mp4':'video/mp4';
 if(h.subarray(0,4).equals(Buffer.from([26,69,223,163])))return 'video/webm';
 if(h.subarray(0,3).toString()==='ID3'||(h[0]===255&&(h[1]!&224)===224))return 'audio/mpeg';
 if(/<svg[\s>]/i.test(h.toString()))return 'image/svg+xml';
 return 'application/octet-stream';
}
