import {createHash} from 'node:crypto';
import type {Database,Tx} from '../../db/src/db';
import {AppError,canonical} from './protocol';
type Query=Pick<Database,'query'>|Tx;
export type DeleteRow={schema:string;table:string;key:Record<string,any>;data:Record<string,any>};
type Relation={schema:string;table:string;columns:string[];pk:string[]};
type Edge={schema:string;table:string;parent_schema:string;parent_table:string;columns:string[];parent_columns:string[]};
export const quoted=(s:string)=>'"'+s.replaceAll('"','""')+'"';
const protectedNames=new Set(['workspaces','users','memberships','instance_state','schema_migrations','audit_logs','idempotency_records','process_health','sessions','login_limits','invitations','metric_definitions','source_connections','collection_runs','source_items','source_observations','topic_clusters','account_deletions','account_deleted_ai_usage','account_owned_relations']);
const labels:Record<string,string>={accounts:'账号登记',account_memberships:'账号权限关联',topics:'选题',topic_evidence:'选题证据',topic_decisions:'选题决策',ai_requests:'AI生成记录',ai_runs:'AI运行缓存',ai_attempts:'AI调用记录',jobs:'后台任务',outbox:'后台事件',publications:'本地笔记登记',file_objects:'文件记录',upload_sessions:'上传记录',import_batches:'导入批次',import_rows:'导入行',metric_observations:'指标',metric_evidence:'指标证据',observation_supersessions:'指标更正历史',calculations:'计算',reports:'复盘',strategy_memories:'策略',feedback:'反馈',source_organizations:'来源整理',account_verifications:'验证记录',notifications:'通知',idempotency_records:'请求缓存'};
export async function deletionCatalog(q:Query){
 const relations:Relation[]=(await q.query(`SELECT n.nspname schema,c.relname table,array_agg(a.attname::text ORDER BY a.attnum) columns,
 ARRAY(SELECT pa.attname::text FROM pg_constraint pk CROSS JOIN LATERAL unnest(pk.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute pa ON pa.attrelid=c.oid AND pa.attnum=k.num WHERE pk.contype='p' AND pk.conrelid=c.oid ORDER BY k.ord) pk
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 WHERE c.relkind='r' AND n.nspname IN('public','retired') GROUP BY c.oid,n.nspname,c.relname ORDER BY n.nspname,c.relname`)).rows;
 const edges:Edge[]=(await q.query(`SELECT n.nspname schema,c.relname table,pn.nspname parent_schema,p.relname parent_table,
 array_agg(ca.attname::text ORDER BY k.ord) columns,array_agg(pa.attname::text ORDER BY k.ord) parent_columns
 FROM pg_constraint fk JOIN pg_class c ON c.oid=fk.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class p ON p.oid=fk.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace
 CROSS JOIN LATERAL unnest(fk.conkey,fk.confkey) WITH ORDINALITY k(cnum,pnum,ord)
 JOIN pg_attribute ca ON ca.attrelid=c.oid AND ca.attnum=k.cnum JOIN pg_attribute pa ON pa.attrelid=p.oid AND pa.attnum=k.pnum
 WHERE fk.contype='f' AND n.nspname IN('public','retired') GROUP BY fk.oid,n.nspname,c.relname,pn.nspname,p.relname`)).rows;return {relations,edges};
}
export async function buildDeletionPlan(q:Query,workspace:string,account:string,operationId?:string){
 const {relations,edges}=await deletionCatalog(q),byName=new Map(relations.map(r=>[r.schema+'.'+r.table,r])),selected=new Map<string,DeleteRow>(),detaches:DeleteRow[]=[];
 const keyFor=(r:Relation,data:any)=>{const cols=r.pk.length?r.pk:r.table==='relationships'?['entity','id']:r.table==='idempotency_records'?['workspace_id','actor_id','method','route','key']:r.columns.includes('id')?['id']:[];if(!cols.length)throw new AppError(409,'DELETION_UNKNOWN_RELATION','发现没有可识别主键的关联记录，需要维护人员核对');return Object.fromEntries(cols.map(c=>[c,data[c]]));};
 const identity=(r:DeleteRow)=>r.schema+'.'+r.table+':'+canonical(r.key);
 function add(rel:Relation,data:any){
  if(data.workspace_id&&data.workspace_id!==workspace)return false;
  if(rel.table==='accounts'&&(rel.schema!=='public'||data.id!==account))return false;
  if(data.account_id&&data.account_id!==account)return false;
  const row={schema:rel.schema,table:rel.table,key:keyFor(rel,data),data},key=identity(row);if(selected.has(key))return false;selected.set(key,row);return true;
 }
 const allowed=(r:Relation)=>r.schema==='retired'?!['idempotency_records','ai_runs','relationships'].includes(r.table):!protectedNames.has(r.table);
 for(const r of relations){
  if(r.schema==='public'&&r.table==='accounts'){for(const d of (await q.query('SELECT to_jsonb(t) data FROM accounts t WHERE workspace_id=$1 AND id=$2',[workspace,account])).rows)add(r,d.data);}
  else if(allowed(r)&&r.columns.includes('account_id')){const clause=r.columns.includes('workspace_id')?' AND workspace_id=$2':'';for(const d of (await q.query(`SELECT to_jsonb(t) data FROM ${quoted(r.schema)}.${quoted(r.table)} t WHERE account_id=$1${clause}`,clause?[account,workspace]:[account])).rows)add(r,d.data);}
 }
 async function matching(edge:Edge,parents:DeleteRow[]){const out:any[]=[];for(let start=0;start<parents.length;start+=100){const values:any[]=[],parts:string[]=[];for(const parent of parents.slice(start,start+100)){if(edge.parent_columns.some(c=>parent.data[c]===null||parent.data[c]===undefined))continue;parts.push('('+edge.columns.map((c,i)=>{values.push(parent.data[edge.parent_columns[i]!]);return quoted(c)+'=$'+values.length;}).join(' AND ')+')');}if(parts.length)out.push(...(await q.query(`SELECT to_jsonb(t) data FROM ${quoted(edge.schema)}.${quoted(edge.table)} t WHERE ${parts.join(' OR ')}`,values)).rows.map(r=>r.data));}return out;}
 async function descendants(){let changed=true;while(changed){changed=false;for(const edge of edges){const child=byName.get(edge.schema+'.'+edge.table);if(!child||!allowed(child))continue;const parents=[...selected.values()].filter(r=>r.schema===edge.parent_schema&&r.table===edge.parent_table);if(!parents.length)continue;for(const data of await matching(edge,parents))if(add(child,data))changed=true;}}}
 await descendants();
 // AI cache rows may be parent references rather than account-owned children.
 const runs=byName.get('public.ai_runs')!,candidateRuns=new Map<string,any>();
 for(const row of selected.values())if(row.data.ai_run_id){const data=(await q.query('SELECT to_jsonb(r) data FROM ai_runs r WHERE id=$1 AND workspace_id=$2',[row.data.ai_run_id,workspace])).rows[0]?.data;if(data)candidateRuns.set(data.id,data);}
 for(const data of candidateRuns.values())add(runs,data);await descendants();
 // Shared AI caches remain available to other accounts; detach only the obsolete job pointer.
 const outsideRuns=new Set<string>();
 for(const edge of edges.filter(e=>e.parent_schema==='public'&&e.parent_table==='ai_runs'&&e.table!=='ai_attempts')){
  for(const parent of [...selected.values()].filter(r=>r.schema==='public'&&r.table==='ai_runs'))for(const data of await matching(edge,[parent])){
   const rel=byName.get(edge.schema+'.'+edge.table)!;const probe={schema:rel.schema,table:rel.table,key:keyFor(rel,data),data};if(!selected.has(identity(probe)))outsideRuns.add(parent.data.id);
  }
 }
 for(const [key,row] of [...selected])if(row.schema==='public'&&(row.table==='ai_runs'&&outsideRuns.has(row.data.id)||row.table==='ai_attempts'&&outsideRuns.has(row.data.run_id))){selected.delete(key);if(row.table==='ai_runs'&&[...selected.values()].some(j=>j.table==='jobs'&&j.data.id===row.data.job_id))detaches.push(row);}
 const ids=new Set([...selected.values()].map(r=>r.data.id).filter((v):v is string=>typeof v==='string'));
 const hasId=(value:any):boolean=>typeof value==='string'?ids.has(value):Array.isArray(value)?value.some(hasId):!!value&&typeof value==='object'&&Object.values(value).some(hasId);
 for(const name of ['public.idempotency_records','retired.idempotency_records','retired.relationships','retired.ai_runs']){
  const r=byName.get(name);if(!r)continue;const scope=r.columns.includes('workspace_id')?' WHERE workspace_id=$1':'';
  for(const item of (await q.query(`SELECT to_jsonb(t) data FROM ${quoted(r.schema)}.${quoted(r.table)} t${scope}`,scope?[workspace]:[])).rows){
   const data=item.data;if(operationId&&data.response?.operation?.id===operationId)continue;
   if(name.endsWith('idempotency_records')){const response=data.response;if(response?.account_id&&response.account_id!==account)continue;if(response?.id===operationId)continue;if(hasId(response))add(r,data);}
   else if((!data.legacy?.account_id||data.legacy.account_id===account)&&hasId(data.legacy??data.input_refs??data))add(r,data);
  }
 }
 // Notifications without a job FK may still point to a removed object.
 const notifications=byName.get('public.notifications');if(notifications)for(const item of (await q.query('SELECT to_jsonb(n) data FROM notifications n WHERE workspace_id=$1',[workspace])).rows){const ref=item.data.task_ref?.split(':').at(-1);if(ids.has(ref))add(notifications,item.data);}
 // Any excluded inbound reference must be explicitly shared/retained, never silently cascaded.
 for(const edge of edges){const parents=[...selected.values()].filter(r=>r.schema===edge.parent_schema&&r.table===edge.parent_table);if(!parents.length)continue;
  for(const data of await matching(edge,parents)){
   const rel=byName.get(edge.schema+'.'+edge.table)!;const probe={schema:rel.schema,table:rel.table,key:keyFor(rel,data),data};if(selected.has(identity(probe)))continue;
   if(edge.schema==='public'&&edge.table==='ai_runs'&&detaches.some(r=>r.data.id===data.id)&&edge.columns.every(c=>c==='workspace_id'||c==='job_id'))continue;
   throw new AppError(409,'DELETION_SHARED_REFERENCE','发现其他账号或共享对象仍在引用这些数据，已停止清理以避免影响其他账号');
  }
 }
 const rows=[...selected.values()],counts:Record<string,number>={};for(const row of rows){const label=row.schema==='retired'?'旧版历史记录':labels[row.table]??'关联记录';counts[label]=(counts[label]??0)+1;}
 const fileMap=new Map<string,{key:string;ready:boolean;upload_id?:string}>();
 for(const row of rows){
  if(!['file_objects','upload_sessions'].includes(row.table)||!row.data.object_key)continue;
  const key=row.data.object_key,previous=fileMap.get(key),isObject=row.table==='file_objects';
  // Deduplicated completed uploads may have discarded their unused original object key.
  const ready=isObject||row.data.status==='completed'&&rows.some(r=>r.table==='file_objects'&&r.data.id===row.data.file_id&&r.data.object_key===key);
  fileMap.set(key,{key,ready:!!previous?.ready||ready,upload_id:previous?.upload_id??(isObject?undefined:row.data.storage_upload_id??undefined)});
 }
 const files=[...fileMap.values()];
 const retained=new Set<string>();for(const file of files){const refs=(await q.query('SELECT id FROM file_objects WHERE object_key=$1',[file.key])).rows;if(refs.some(r=>!rows.some(d=>d.table==='file_objects'&&d.data.id===r.id)))retained.add(file.key);}
 const ownedFiles=files.map(f=>({...f,remove:!retained.has(f.key)}));
 const fingerprint=createHash('sha256').update(canonical(rows.filter(r=>r.table!=='idempotency_records').map(r=>[r.schema,r.table,r.key]).sort((a,b)=>canonical(a).localeCompare(canonical(b))))).digest('hex');
 return {rows,counts,files:ownedFiles,detaches,fingerprint,retained_shared_files:retained.size};
}
