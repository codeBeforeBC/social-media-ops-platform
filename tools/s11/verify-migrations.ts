import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {Database} from '../../packages/db/src/db';
import {migrate} from '../../packages/db/src/migrate';
import {canonical,sha} from '../../packages/domain/src/protocol';
import assert from 'node:assert/strict';
const config=JSON.parse(readFileSync('.local/state/instance.json','utf8'));
const url=(name:string)=>`postgresql://yoyo:${config.database_password}@127.0.0.1:54329/${name}`;
const retired=['folders','assets','asset_versions','asset_favorites','asset_relations','asset_usages','brand_rules','rule_sets','operational_proposals','contents','content_revisions','media_deliverables','reviews','export_packages','publication_drafts','publication_changes'];
async function snapshot(db:Database){const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(x=>x.tablename);const counts:Record<string,number>={};for(const t of tables)counts[t]=(await db.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n;const identity=tables.includes('publications')?(await db.query('SELECT id,workspace_id,account_id,platform_note_id,url,published_at,recorded_by FROM publications ORDER BY id')).rows:[];const files=tables.includes('file_objects')?(await db.query('SELECT id,object_key,sha256 FROM file_objects ORDER BY id')).rows:[];return {counts,identity_hash:sha(canonical(identity)),file_hash:sha(canonical(files))};}
async function main(){const report:any={date:'2026-10-09',base:'e4bd051',actual_backup_copies:[],fresh:null};
 const dumps=readdirSync('.local/s11-backups').filter(n=>n.endsWith('.dump')).sort();assert.equal(dumps.length,7);
 for(const [i,dump] of dumps.entries()){
  const name=`yoyo_s11_upgrade_${i}_test`;execFileSync('docker',['exec','yoyo-dev-db-1','dropdb','-U','yoyo','--if-exists',name]);execFileSync('docker',['exec','yoyo-dev-db-1','createdb','-U','yoyo',name]);
  execFileSync('docker',['exec','-i','yoyo-dev-db-1','pg_restore','-U','yoyo','-d',name,'--no-owner'],{input:readFileSync('.local/s11-backups/'+dump),stdio:['pipe','pipe','pipe'],maxBuffer:10*1024*1024});
  const db=new Database(url(name));try{const before=await snapshot(db);await migrate(db);await migrate(db);const after=await snapshot(db);assert.equal(after.identity_hash,before.identity_hash);assert.equal(after.file_hash,before.file_hash);
   for(const [table,count] of Object.entries(before.counts)){if(table==='schema_migrations'||table==='audit_logs')continue;const value=retired.includes(table)?(await db.query(`SELECT count(*)::int n FROM retired.${table}`)).rows[0].n:after.counts[table];assert.equal(value,count,table);}
   assert.equal((await db.query("SELECT count(*)::int n FROM jobs WHERE state IN ('queued','running') AND NOT yoyo_job_supported(type,pool,input)")).rows[0].n,0);
   assert.equal((await db.query("SELECT count(*)::int n FROM memberships WHERE 'reviewer'=ANY(roles)")).rows[0].n,0);
   assert.equal((await db.query("SELECT count(*)::int n FROM outbox WHERE dispatched_at IS NULL AND event_type='publication.recorded'")).rows[0].n,0);
   report.actual_backup_copies.push({backup:dump,before_counts:before.counts,publication_identity_preserved:true,file_ids_keys_hashes_preserved:true,history_counts_preserved:true,migrations:after.counts.schema_migrations,result:'passed'});
  }finally{await db.close();}writeFileSync('docs/evidence/s11/migration-verification.json',JSON.stringify(report,null,2)+'\n');
 }
 const fresh='yoyo_s11_fresh_test';execFileSync('docker',['exec','yoyo-dev-db-1','dropdb','-U','yoyo','--if-exists',fresh]);execFileSync('docker',['exec','yoyo-dev-db-1','createdb','-U','yoyo',fresh]);const db=new Database(url(fresh));try{await migrate(db);await migrate(db);assert.equal((await db.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n,26);assert.equal((await db.query("SELECT to_regclass('public.contents') missing")).rows[0].missing,null);assert.ok((await db.query("SELECT to_regclass('retired.contents') present")).rows[0].present);report.fresh={result:'passed',migrations:26,idempotent_rerun:true};}finally{await db.close();}writeFileSync('docs/evidence/s11/migration-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({copies:report.actual_backup_copies.length,fresh:report.fresh.result}));}
main().catch(e=>{console.error('MIGRATION_VERIFICATION_FAILED',e.code??e.message);process.exitCode=1;});
