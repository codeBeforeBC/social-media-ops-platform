import {z} from 'zod';
import {Tx} from '../../db/src/db';
import {graphicOutputSchema,videoOutputSchema} from './ai-workflows';
import {AppError,canonical,sha,id} from './protocol';
const roots=new Set(['title','body','tags','brief','pages','shots','deliverables']);
export function lockPaths(paths:unknown,base:Record<string,any>):string[]{
 const fields=z.array(z.string().min(1).max(200)).max(100).parse(paths);
 const out=fields.map(field=>field.startsWith('/')?field:'/'+field);
 for(const path of out){const parts=path.slice(1).split('/');if(!roots.has(parts[0]!)||parts.some(p=>!p||['__proto__','prototype','constructor'].includes(p)||!/^\w+$/.test(p)))throw new AppError(422,'LOCK_PATH_INVALID','锁定字段路径无效');let value:any=base;for(const p of parts){if(value===null||typeof value!=='object'||!Object.hasOwn(value,p))throw new AppError(422,'LOCK_PATH_MISSING','锁定字段在基础版本中不存在');value=value[p];}}
 return [...new Set(out)].sort();
}
export function preserveLocks(payload:Record<string,any>,base:Record<string,any>,paths:string[]){
 const result=structuredClone(payload);
 for(const path of paths){const parts=path.slice(1).split('/');let source:any=base,target:any=result;for(const p of parts.slice(0,-1)){source=source[p];if(target[p]===null||typeof target[p]!=='object')throw new AppError(422,'LOCKED_STRUCTURE_CONFLICT','生成结构无法保留人工字段');target=target[p];}const key=parts.at(-1)!;if(Array.isArray(target)&&(!/^\d+$/.test(key)||Number(key)>=target.length))throw new AppError(422,'LOCKED_STRUCTURE_CONFLICT','生成结果删除了锁定的页或镜头');target[key]=structuredClone(source[key]);}
 return result;
}
export function generatedPayload(request:any,output:unknown){
 const snapshot=request.snapshot,base=snapshot.base_payload as Record<string,any>;
 const result=request.kind==='graphic'?graphicOutputSchema.parse(output):videoOutputSchema.parse(output);
 if(result.input_version!==request.input_version)throw new AppError(422,'BRIEF_INPUT_MISMATCH','制作单基础输入版本不符');
 const task=result.task_payload as any;
 const payload:Record<string,any>={...structuredClone(base),title:task.title_options[0],title_options:task.title_options,body:task.body,brief:{...base.brief,...(request.kind==='graphic'?{goal:task.goal,audience:task.audience,interaction_question:task.interaction_question,fact_check_items:task.fact_check_items}:{target_duration_ms:task.target_duration_ms,aspect_ratio:task.aspect_ratio,cover_options:task.cover_options}),delivery_spec:task.delivery_spec},pages:request.kind==='graphic'?task.pages.map((p:any)=>({...p,publish_file_id:null})):[],shots:request.kind==='video'?task.shots.map((s:any)=>({position:s.position,start_ms:s.start_ms,end_ms:s.end_ms,action:s.action,subtitle:s.subtitle,voiceover:s.voiceover_optional,sound:s.sound_note,asset_refs:s.asset_version_ids.map((v:string)=>({asset_version_id:v,usage_role:'shot'}))})):[],missing_inputs:[...new Set([...(base.missing_inputs??[]),...result.missing_inputs])],warnings:[...new Set([...(base.warnings??[]),...result.warnings])],locked_fields:snapshot.preserve_fields??base.locked_fields??[]};
 // Confirmed audience/goal/follow reason and explicit human locks always win over generation.
 const mandatory=['/brief/goal','/brief/audience','/brief/follow_reason'].filter(path=>Object.hasOwn(base.brief??{},path.split('/').at(-1)!));
 const paths=lockPaths([...mandatory,...payload.locked_fields],base);const merged=preserveLocks(payload,base,paths);merged.locked_fields=paths;
 validateGenerated(merged,request.kind,snapshot.assets.map((a:any)=>a.asset_version_id));return merged;
}
export function referencedVersions(payload:any):{id:string;role:string}[]{return [...(payload.pages??[]).flatMap((p:any)=>(p.asset_version_ids??[]).map((id:string)=>({id,role:'page:'+p.position}))),...(payload.shots??[]).flatMap((s:any)=>(s.asset_refs??[]).map((a:any)=>({id:a.asset_version_id,role:'shot:'+s.position})))];}
function validateGenerated(payload:any,kind:string,allowed:string[]){
 // Human locks are merged after model validation, so validate the resulting production fields again.
 try{
  z.string().min(1).max(200).parse(payload.title);z.string().max(10000).parse(payload.body);
  if(kind==='graphic')graphicOutputSchema.shape.task_payload.shape.pages.element.passthrough().array().min(1).max(30).parse(payload.pages);
  else videoOutputSchema.shape.task_payload.parse({target_duration_ms:payload.brief.target_duration_ms,aspect_ratio:payload.brief.aspect_ratio,shots:payload.shots.map((s:any)=>({position:s.position,start_ms:s.start_ms,end_ms:s.end_ms,action:s.action,subtitle:s.subtitle,voiceover_optional:s.voiceover,sound_note:s.sound,asset_version_ids:s.asset_refs.map((r:any)=>r.asset_version_id)})),cover_options:payload.brief.cover_options,title_options:[payload.title],body:payload.body,delivery_spec:payload.brief.delivery_spec});
 }catch{throw new AppError(422,'BRIEF_PAYLOAD_INVALID','保留人工字段后的制作单不符合结构约束');}

 if(typeof payload.title!=='string'||payload.title.length>200||typeof payload.body!=='string'||payload.body.length>10000)throw new AppError(422,'BRIEF_PAYLOAD_INVALID','锁定后的文案无效');
 if(kind==='graphic'){if(!payload.pages.length||payload.pages.length>30||payload.pages.some((p:any,i:number)=>!p||p.position!==i+1||typeof p.visual_instruction!=='string'||typeof p.page_copy!=='string'))throw new AppError(422,'BRIEF_PAGES_INVALID','锁定后的页面结构无效');}
 else{let end=0;if(!payload.shots.length||payload.shots.length>100)throw new AppError(422,'BRIEF_SHOTS_INVALID','镜头数量无效');for(const [i,s] of payload.shots.entries()){if(!s||s.position!==i+1||!Number.isInteger(s.start_ms)||!Number.isInteger(s.end_ms)||s.start_ms!==end||s.end_ms<=s.start_ms)throw new AppError(422,'BRIEF_TIMELINE_INVALID','锁定后的分镜有间隙或重叠');end=s.end_ms;}if(end!==payload.brief.target_duration_ms)throw new AppError(422,'BRIEF_TIMELINE_INVALID','分镜终点与目标时长不一致');}
 if(referencedVersions(payload).some(ref=>!allowed.includes(ref.id)))throw new AppError(422,'BRIEF_ASSET_NOT_ALLOWED','生成或锁定内容包含允许集合外的资产版本');
}
export async function saveGenerated(tx:Tx,request:any,payload:Record<string,any>){
 const s=request.snapshot;const content=(await tx.query('SELECT * FROM contents WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[request.workspace_id,s.content_id])).rows[0];
 if(!content||content.current_revision_id!==s.base_revision_id||content.version!==s.content_version||!['draft','in_production'].includes(content.business_status))throw new AppError(409,'STALE_INPUT','内容基础版本已经变更');
 const existing=(await tx.query("SELECT id FROM content_revisions WHERE ai_request_id=$1 AND origin='ai_candidate'",[request.id])).rows[0];if(existing)return existing.id;
 const revision=id(),next=(await tx.query('SELECT COALESCE(max(revision_no),0)+1 n FROM content_revisions WHERE content_id=$1',[content.id])).rows[0].n;
 await tx.query("INSERT INTO content_revisions(id,workspace_id,content_id,created_by,revision_no,frozen,payload,origin,base_revision_id,ai_request_id,payload_hash) VALUES($1,$2,$3,$4,$5,true,$6,'ai_candidate',$7,$8,$9)",[revision,request.workspace_id,content.id,request.created_by,next,JSON.stringify(payload),s.base_revision_id,request.id,sha(canonical(payload))]);
 await tx.query('UPDATE ai_requests SET result_revision_id=$2 WHERE id=$1',[request.id,revision]);return revision;
}
export async function saveRevisionAssetUsages(tx:Tx,workspaceId:string,memberId:string,revisionId:string,payload:any){
 for(const ref of referencedVersions(payload)){const version=(await tx.query('SELECT av.*,a.business_status,a.id asset_id FROM asset_versions av JOIN assets a ON a.id=av.asset_id WHERE av.workspace_id=$1 AND av.id=$2 FOR SHARE OF av,a',[workspaceId,ref.id])).rows[0];if(!version||version.business_status==='retired'||(version.valid_until&&new Date(version.valid_until).getTime()<=Date.now()))throw new AppError(422,'ASSET_UNUSABLE','素材版本已停用、过期或不存在');
 await tx.query('INSERT INTO asset_usages(workspace_id,created_by,asset_version_id,revision_id,usage_role,permission_snapshot) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[workspaceId,memberId,ref.id,revisionId,ref.role,JSON.stringify({asset_status:version.business_status,usage_scope:version.usage_scope,permission_confirmed_at:version.permission_confirmed_at})]);}
}
