import {readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Database} from './db';
export async function migrate(db:Database){
  const client=await db.pool.connect();
  try{
    await client.query("SELECT pg_advisory_lock(731091)");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for(const name of readdirSync(resolve('packages/db/migrations')).filter(n=>n.endsWith('.sql')).sort()){
      const sql=readFileSync(resolve('packages/db/migrations',name),'utf8');const hash=createHash('sha256').update(sql).digest('hex');
      const old=await client.query('SELECT checksum FROM schema_migrations WHERE name=$1',[name]);
      if(old.rowCount){if(old.rows[0].checksum!==hash)throw new Error(`Applied migration changed: ${name}`);continue;}
      await client.query('BEGIN');
      try{await client.query(sql);await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,hash]);await client.query('COMMIT');console.log(`Applied ${name}`);}
      catch(e){await client.query('ROLLBACK');throw e;}
    }
  }finally{await client.query('SELECT pg_advisory_unlock(731091)');client.release();}
}
if(require.main===module){const db=new Database();migrate(db).finally(()=>db.close()).catch(()=>{console.error('Migration failed; inspect migration/schema compatibility.');process.exitCode=1;});}
