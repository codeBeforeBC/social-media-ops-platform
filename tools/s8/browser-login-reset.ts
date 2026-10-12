// More than ten separate browser logins share the loopback test IP; reset its quota only in the explicitly disposable fixture database.
import {Database} from '../../packages/db/src/db';
import {databaseUrl} from '../../packages/domain/src/config';
async function main(){const url=databaseUrl(true),name=new URL(url).pathname.slice(1);if(!['yoyo_s8_test','yoyo_s7_ocr_test','yoyo_ci_test'].includes(name)||process.env.ALLOW_TEST_RESET!==name)throw new Error('Explicit supported disposable browser fixture required');const db=new Database(url);try{await db.query('TRUNCATE login_limits');}finally{await db.close();}}
main().catch(()=>{process.exitCode=1;});
