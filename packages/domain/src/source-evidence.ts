import {Database,Tx} from '../../db/src/db';
import {Actor,AppError,canonical,page,pagination,sha,uuid,parse} from './protocol';
import {CollectionResult,Connection} from './collection';
import {validateSourceResult} from './source-adapters';
export async function saveSourceItems(tx:Tx,c:Connection,runId:string,raw:CollectionResult){
 const result=validateSourceResult(raw);const seen=new Set<string>();
 for(const item of result.items){
  if(seen.has(item.external_id))continue;seen.add(item.external_id);
  // Grouping preserves distinct source records. No cross-source deletion or synthetic metric merging.
  const cluster=sha(item.title.normalize('NFC').toLocaleLowerCase().replace(/\s+/g,' ').trim());
  const {captured_at,...content}=item;const fingerprint=sha(canonical(content));
  const r=await tx.query(`INSERT INTO source_items(workspace_id,connection_id,external_id,canonical_url,actual_source_type,title,summary,author,published_at,date_label_raw,captured_at,media_type,visible_counts,rank,keyword,cluster_key,content_hash)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
   ON CONFLICT(connection_id,external_id) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,author=EXCLUDED.author,published_at=EXCLUDED.published_at,date_label_raw=EXCLUDED.date_label_raw,captured_at=EXCLUDED.captured_at,media_type=EXCLUDED.media_type,visible_counts=EXCLUDED.visible_counts,rank=EXCLUDED.rank,keyword=EXCLUDED.keyword,content_hash=EXCLUDED.content_hash,cluster_key=EXCLUDED.cluster_key,version=source_items.version+1,updated_at=now()
   WHERE source_items.captured_at<=EXCLUDED.captured_at RETURNING id`,[c.workspace_id,c.id,item.external_id,item.canonical_url,item.actual_source_type,item.title,item.summary,item.author,item.published_at,item.date_label_raw,item.captured_at,item.media_type,JSON.stringify(item.visible_counts),item.rank,item.keyword??null,cluster,fingerprint]);
  const itemId=r.rows[0]?.id??(await tx.query('SELECT id FROM source_items WHERE connection_id=$1 AND external_id=$2',[c.id,item.external_id])).rows[0].id;
  await tx.query(`INSERT INTO source_observations(workspace_id,source_item_id,run_id,captured_at,payload,content_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source_item_id,run_id) DO NOTHING`,[c.workspace_id,itemId,runId,item.captured_at,JSON.stringify(item),fingerprint]);
 }
}
export class SourceEvidence {
 constructor(readonly db:Database){}
 async list(a:Actor,q:Record<string,unknown>){
  const {limit,cursor}=pagination(q);let cid:string|null=null;
  if(q.connection_id)cid=parse(uuid,q.connection_id);
  const freshness=q.freshness===undefined?'all':String(q.freshness);if(!['all','fresh','expired'].includes(freshness))throw new AppError(422,'INVALID_FILTER','时效筛选无效');
  const r=await this.db.query(`SELECT i.*,c.platform,c.source_type,c.name connection_name,c.health connection_health,
   c.source_type<>'xhs_quality_note' AND i.captured_at<now()-interval '24 hours' expired,
   (SELECT count(*)::int FROM source_items peer WHERE peer.workspace_id=i.workspace_id AND peer.cluster_key=i.cluster_key) cluster_size
   FROM source_items i JOIN source_connections c ON c.id=i.connection_id
   WHERE i.workspace_id=$1 AND ($2::uuid IS NULL OR i.connection_id=$2)
   AND ($3::text IS NULL OR i.title ILIKE '%'||$3||'%' OR i.summary ILIKE '%'||$3||'%' OR i.keyword ILIKE '%'||$3||'%')
   AND ($4='all' OR ($4='expired' AND c.source_type<>'xhs_quality_note' AND i.captured_at<now()-interval '24 hours') OR ($4='fresh' AND (c.source_type='xhs_quality_note' OR i.captured_at>=now()-interval '24 hours')))
   AND ($5::timestamptz IS NULL OR (i.captured_at,i.id)<($5,$6::uuid)) ORDER BY i.captured_at DESC,i.id DESC LIMIT $7`,[a.workspaceId,cid,q.keyword?String(q.keyword).slice(0,200):null,freshness,cursor?.at??null,cursor?.id??null,limit+1]);return page(r.rows,limit,'captured_at');
 }
 async detail(a:Actor,sid:string){
  const r=await this.db.query('SELECT * FROM source_items WHERE workspace_id=$1 AND id=$2',[a.workspaceId,parse(uuid,sid)]);if(!r.rowCount)throw new AppError(404,'NOT_FOUND','来源证据不存在或不可见');
  const observations=await this.db.query('SELECT * FROM source_observations WHERE workspace_id=$1 AND source_item_id=$2 ORDER BY captured_at DESC,id DESC LIMIT 100',[a.workspaceId,sid]);
  return {...r.rows[0],observations:observations.rows};
 }
}
