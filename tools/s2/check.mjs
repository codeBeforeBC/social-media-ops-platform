import {readFileSync,chmodSync} from 'node:fs';
import {spawn} from 'node:child_process';
const existing=process.env.STATE_DIR??'.local/state';let database=process.env.TEST_DATABASE_URL;
if(!database){const c=JSON.parse(readFileSync(existing+'/instance.json','utf8'));database=`postgresql://yoyo:${c.database_password}@127.0.0.1:54329/yoyo_test`;}
if(!new URL(database).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
const env={...process.env,TEST_DATABASE_URL:database,STATE_DIR:'.local/s2-test-state',S3_ENDPOINT:'http://127.0.0.1:59020',S3_PUBLIC_ENDPOINT:'http://127.0.0.1:59020',MEDIA_ENDPOINT:'http://127.0.0.1:59030',S3_BUCKET:'yoyo-s2-test'};
async function run(cmd,args){await new Promise((resolve,reject)=>{const p=spawn(cmd,args,{stdio:'inherit',env});p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(new Error(`${cmd} failed (${c})`)));});}
await run('node',['tools/init-state.mjs']);
// Only this isolated test token is readable by the container UID. Production credentials retain restrictive modes.
chmodSync('.local/s2-test-state/media/media-token',0o644);
await run('docker',['compose','-f','compose.test.yaml','up','-d','--build','--wait']);
let ready=false;for(let n=0;n<20;n++){try{await run('pnpm',['exec','tsx','tools/storage-init.ts']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,1000));}}if(!ready)throw new Error('Test storage not ready');
const args=process.argv.slice(2);
if(args.length)await run(args[0],args.slice(1));else{await run('pnpm',['check']);await run('node',['tools/test-env.mjs','pnpm','exec','playwright','test']);}
