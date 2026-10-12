import {readFileSync,writeFileSync,mkdirSync,statSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Database} from '../../packages/db/src/db';

async function main(){
 const c=JSON.parse(readFileSync('.local/state/instance.json','utf8'));
 const sql="SELECT datname FROM pg_database WHERE NOT datistemplate AND datname<>'postgres' ORDER BY datname";
 const catalog=new Database(`postgresql://yoyo:${c.database_password}@127.0.0.1:54329/postgres`);
 const names=(await catalog.query(sql)).rows.map(r=>r.datname);await catalog.close();
 const databases:any[]=[];
 for(const name of names){
  const db=new Database(`postgresql://yoyo:${c.database_password}@127.0.0.1:54329/${name}`);
  try{
   await db.query('BEGIN READ ONLY');
   const tables=(await db.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','retired') ORDER BY 1,2")).rows;
   const counts:any={};for(const t of tables)counts[t.schemaname+'.'+t.tablename]=(await db.query(`SELECT count(*)::int n FROM "${t.schemaname}"."${t.tablename}"`)).rows[0].n;
   databases.push({database:name,classification:name==='yoyo'?'original_development':name==='yoyo_test'?'preserved_historical':name.includes('_ai_')?'isolated_ai_evaluation':name.endsWith('_test')?'isolated_test_or_upgrade_copy':'isolated_development',counts});
   await db.query('ROLLBACK');
  }finally{await db.close();}
 }
 const configs=['.local/state/instance.json','.local/state/source-bridge-token','.local/ai/deepseek.json','.local/s8-ai-evaluation/config.json'].filter(existsSync).map(path=>{
  const r:any={path,mode:(statSync(path).mode&0o777).toString(8)};
  if(path.includes('ai')&&path.endsWith('.json')){const a=JSON.parse(readFileSync(path,'utf8'));r.enabled=a.enabled;r.model=a.model;}
  return r;
 });
 let bridge='not_listening';try{const response=await fetch('http://127.0.0.1:59025/health',{headers:{Authorization:'Bearer '+readFileSync('.local/state/source-bridge-token','utf8').trim()},signal:AbortSignal.timeout(2000)});bridge=response.ok?'authenticated_healthy':'unhealthy';}catch{}
 const services=execFileSync('docker',['ps','-a','--format','{{.Names}}|{{.State}}|{{.Ports}}'],{encoding:'utf8'}).trim().split('\n');
 const historical=execFileSync('git',['ls-files','packages/db/migrations'],{encoding:'utf8'}).trim().split('\n').map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));
 mkdirSync('docs/evidence/s9',{recursive:true});writeFileSync('docs/evidence/s9/environment.json',JSON.stringify({checked_at:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),databases,configs,services,bridge,historical_migrations:historical,original_data_mutated:false,credentials_printed:false},null,2)+'\n');
 console.log(JSON.stringify({databases:databases.length,configs:configs.length,bridge,historical_migrations:historical.length,credentials_printed:false}));
}
main().catch(()=>{console.error('S9 inventory failed; no connection details printed');process.exitCode=1;});
