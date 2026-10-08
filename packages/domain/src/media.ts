import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Database} from '../../db/src/db';
import {Storage} from './storage';
import {JobHandler} from './jobs';
import {config} from './config';
export function mediaHandler(db:Database,store:Storage):JobHandler{
 return async(j,signal)=>{
  const f=(await db.query('SELECT * FROM file_objects WHERE id=$1 AND workspace_id=$2 AND is_preview=false',[j.input.file_id,j.workspace_id])).rows[0];if(!f)throw new Error('FILE_MISSING');
  if(f.preview_status==='ready'||f.preview_status==='unsupported')return {result:{file_id:f.id,status:f.preview_status}};
  const endpoint=process.env.MEDIA_ENDPOINT??'http://127.0.0.1:59010';const c=JSON.parse(readFileSync(resolve(config.stateDir,'instance.json'),'utf8'));const headers={'X-Media-Token':c.media_token};
  await db.query("UPDATE file_objects SET preview_status='processing' WHERE id=$1",[f.id]);
  let outputId:string|undefined;const staged:{id:string;key:string;mime:string;name:string;size_bytes:number;sha256:string;page?:number}[]=[];
  try{
   const source=await store.get(f.object_key);const response=await fetch(endpoint+'/process',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','X-Media-Mime':f.detected_mime},body:source.Body as any,duplex:'half',signal} as any);
   if(!response.ok){const error=await response.json().catch(()=>({})) as any;if(error.code==='INVALID_PNG'){await db.query("UPDATE file_objects SET file_status='quarantined' WHERE id=$1",[f.id]);throw new Error('MEDIA_INVALID_FILE');}throw new Error('MEDIA_PARSE_FAILED');}const result=await response.json() as any;outputId=result.id;
   for(const output of result.outputs){if(signal.aborted)throw new Error('JOB_TIMEOUT');const r=await fetch(endpoint+`/outputs/${result.id}/${output.name}`,{headers,signal});if(!r.ok||!r.body)throw new Error('PREVIEW_DOWNLOAD_FAILED');const key=`${f.workspace_id}/previews/${f.id}/${randomUUID()}`;const uploaded=await store.putStream(key,r.body as any,output.mime);staged.push({id:randomUUID(),key,mime:output.mime,name:output.name,page:output.page,...uploaded});}
   return {result:{file_id:f.id,status:result.status,outputs:staged.length},cleanup:async applied=>{for(const p of staged){const ref=await db.query('SELECT id FROM file_objects WHERE object_key=$1',[p.key]);if(!ref.rowCount)await store.remove(p.key).catch(()=>{});}},effects:async tx=>{
    const current=await tx.query('SELECT file_status FROM file_objects WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[f.id,f.workspace_id]);if(!current.rowCount||current.rows[0].file_status!=='ready')throw new Error('FILE_CHANGED');
    for(const p of staged){const r=await tx.query("INSERT INTO file_objects(id,workspace_id,created_by,object_key,original_name,size_bytes,sha256,detected_mime,is_preview,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9) ON CONFLICT(workspace_id,sha256,is_preview) DO UPDATE SET sha256=EXCLUDED.sha256 RETURNING id,object_key",[p.id,f.workspace_id,f.created_by,p.key,p.name,p.size_bytes,p.sha256,p.mime,JSON.stringify({page:p.page??null,source_file_id:f.id})]);p.id=r.rows[0].id;}
    const metadata={...result.metadata,pages_preview:staged.filter(p=>p.page).map(p=>({page:p.page,file_id:p.id})),poster_file_id:staged.find(p=>p.name==='poster.png')?.id??null};
    await tx.query('UPDATE file_objects SET preview_status=$1,preview_file_id=$2,metadata=$3,version=version+1,updated_at=now() WHERE id=$4',[result.status,staged[0]?.id??null,JSON.stringify(metadata),f.id]);
   }};
  }catch(e){await db.query("UPDATE file_objects SET preview_status='failed',metadata=metadata||'{\"preview_error\":\"MEDIA_PARSE_FAILED\"}'::jsonb,updated_at=now() WHERE id=$1 AND preview_status<>'ready'",[f.id]);for(const p of staged)await store.remove(p.key).catch(()=>{});throw e;}
  finally{if(outputId)await fetch(endpoint+'/outputs/'+outputId,{method:'DELETE',headers}).catch(()=>{});}
 };
}
