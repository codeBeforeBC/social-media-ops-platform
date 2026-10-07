import {Database} from '../packages/db/src/db';
import {setupToken} from '../packages/domain/src/config';
async function main(){const db=new Database();try{const r=await db.query('SELECT initialized_at FROM instance_state WHERE id=1');if(r.rows[0]?.initialized_at)throw new Error('Instance already initialized');console.log(setupToken());}finally{await db.close();}}
main().catch(()=>{console.error('Setup token unavailable or initialization already complete.');process.exitCode=1;});
