import {Tx} from '../../db/src/db';
import {AppError,canonical,sha} from './protocol';
import {referencedVersions} from './briefs';
export async function checkPublishable(tx:Tx,workspaceId:string,revision:any){
 const p=revision.payload;
 if(!p.title?.trim()||!p.body?.trim()||!p.pages?.length||p.pages.some((v:any,i:number)=>v.position!==i+1||!v.publish_file_id))throw new AppError(422,'PUBLISH_PAYLOAD_INCOMPLETE','请补齐标题、正文及每页成品，第一页为封面');
 if(revision.payload_hash!==sha(canonical(p)))throw new AppError(409,'REVISION_HASH_INVALID','内容版本校验失败');
 for(const page of p.pages){
  const f=(await tx.query('SELECT * FROM file_objects WHERE workspace_id=$1 AND id=$2 AND NOT is_preview FOR SHARE',[workspaceId,page.publish_file_id])).rows[0];
  if(!f||f.file_status!=='ready'||f.preview_status!=='ready'||f.detected_mime!=='image/png'||!f.preview_file_id)throw new AppError(422,'PUBLISH_PREVIEW_REQUIRED','每页须有已完成且可预览的PNG成品');
 }
 for(const ref of referencedVersions(p).sort((a,b)=>a.id.localeCompare(b.id))){
  const asset=(await tx.query('SELECT av.*,a.business_status FROM asset_versions av JOIN assets a ON a.id=av.asset_id WHERE av.workspace_id=$1 AND av.id=$2 FOR SHARE OF av,a',[workspaceId,ref.id])).rows[0];
  if(!asset||asset.business_status==='retired'||!asset.permission_confirmed_at||(asset.valid_until&&new Date(asset.valid_until)<=new Date()))throw new AppError(422,'ASSET_UNUSABLE','素材使用范围未确认、已停用或过期，请移除或替换');
 }
}
