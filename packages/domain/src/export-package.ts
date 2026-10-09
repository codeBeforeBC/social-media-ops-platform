import {crc32} from 'node:zlib';
import {createHash} from 'node:crypto';
import {Database,Tx} from '../../db/src/db';
import {Storage} from './storage';
import {JobHandler} from './jobs';
import {checkPublishable} from './publication-payload';
import {id} from './protocol';
// Store ZIP entries without recompression: PNG originals stay byte-for-byte identical.
async function* zip(entries:{name:string;stream:AsyncIterable<Uint8Array>;sha256?:string;size_bytes?:number}[],signal:AbortSignal){
 let offset=0;const directory:Buffer[]=[];
 for(const entry of entries){
  const name=Buffer.from(entry.name),start=offset,header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x808,6);header.writeUInt16LE(name.length,26);header.writeUInt16LE(33,12);yield header;yield name;offset+=header.length+name.length;
  let crc=0,size=0;const digest=createHash('sha256');for await(const raw of entry.stream){if(signal.aborted)throw new Error('JOB_TIMEOUT');const chunk=Buffer.from(raw);crc=crc32(chunk,crc);size+=chunk.length;digest.update(chunk);yield chunk;offset+=chunk.length;}
  if((entry.sha256&&digest.digest('hex')!==entry.sha256)||(entry.size_bytes!==undefined&&size!==entry.size_bytes))throw new Error('SOURCE_FILE_CHANGED');
  const descriptor=Buffer.alloc(16);descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,4);descriptor.writeUInt32LE(size,8);descriptor.writeUInt32LE(size,12);yield descriptor;offset+=16;
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x808,8);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(size,20);central.writeUInt32LE(size,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(start,42);directory.push(Buffer.concat([central,name]));
 }
 const start=offset;for(const c of directory){yield c;offset+=c.length;}const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(offset-start,12);end.writeUInt32LE(start,16);yield end;
}
export async function exportGuard(tx:Tx,workspaceId:string,packageId:string){
 const e=(await tx.query('SELECT e.*,c.business_status,c.approved_revision_id,c.current_revision_id FROM export_packages e JOIN contents c ON c.id=e.content_id WHERE e.workspace_id=$1 AND e.id=$2 FOR SHARE OF c',[workspaceId,packageId])).rows[0];
 if(!e||!['ready_to_publish','published'].includes(e.business_status)||e.approved_revision_id!==e.revision_id||e.current_revision_id!==e.revision_id)throw new Error('EXPORT_STALE');
 const revision=(await tx.query('SELECT * FROM content_revisions WHERE id=$1',[e.revision_id])).rows[0];if(!revision.frozen||revision.payload_hash!==e.payload_hash)throw new Error('EXPORT_STALE');await checkPublishable(tx,workspaceId,revision);return {e,revision};
}
export function exportHandler(db:Database,store:Storage):JobHandler{return async(job,signal)=>{
 const {e,revision}=await db.transaction(tx=>exportGuard(tx,job.workspace_id,job.input.export_package_id));
 const files=(await db.query('SELECT f.*,d.position FROM media_deliverables d JOIN file_objects f ON f.id=d.file_id WHERE d.revision_id=$1 ORDER BY position',[revision.id])).rows;
 const manifest={content_id:e.content_id,revision_id:revision.id,payload_hash:e.payload_hash,title:revision.payload.title,body:revision.payload.body,tags:revision.payload.tags??[],pages:files.map(f=>({position:f.position,file_id:f.id,name:String(f.position).padStart(2,'0')+'.png',sha256:f.sha256,size_bytes:Number(f.size_bytes)}))};
 const entries:{name:string;stream:AsyncIterable<Uint8Array>;sha256?:string;size_bytes?:number}[]=[];
 for(const f of files){const body=await store.get(f.object_key);entries.push({name:String(f.position).padStart(2,'0')+'.png',stream:body.Body as any,sha256:f.sha256,size_bytes:Number(f.size_bytes)});}
 entries.push({name:'manifest.json',stream:(async function*(){yield Buffer.from(JSON.stringify(manifest,null,2));})()},{name:'文案.txt',stream:(async function*(){yield Buffer.from(manifest.title+'\n\n'+manifest.body+'\n\n'+manifest.tags.join(' '));})()});
 const fileId=id(),key=`${job.workspace_id}/packages/${id()}`;let applied=false;
 try{const meta=await store.putStream(key,zip(entries,signal),'application/zip');return {
  result:{export_package_id:e.id,revision_id:revision.id,file_id:fileId},guard:async tx=>{try{await exportGuard(tx,job.workspace_id,e.id);return null;}catch{return 'EXPORT_STALE';}},
  effects:async tx=>{
   const file=(await tx.query("INSERT INTO file_objects(id,workspace_id,created_by,object_key,original_name,size_bytes,sha256,detected_mime,preview_status) VALUES($1,$2,$3,$4,$5,$6,$7,'application/zip','unsupported') ON CONFLICT(workspace_id,sha256,is_preview) DO UPDATE SET sha256=EXCLUDED.sha256 RETURNING id",[fileId,e.workspace_id,e.created_by,key,'图文发布包-'+revision.revision_no+'.zip',meta.size_bytes,meta.sha256])).rows[0];
   await tx.query('UPDATE export_packages SET file_id=$2,manifest=$3 WHERE id=$1',[e.id,file.id,JSON.stringify(manifest)]);
  },cleanup:async done=>{applied=done;if(!done)await store.remove(key);}
 };}catch(error){await store.remove(key).catch(()=>{});throw error;}finally{for(const entry of entries){if((entry.stream as any).destroy)(entry.stream as any).destroy();}}
 };}
