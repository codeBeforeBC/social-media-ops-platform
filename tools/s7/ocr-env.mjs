/** Disposable OCR environment only; original and previous stage databases remain untouched. */
import {readFileSync,chmodSync} from 'node:fs';
import {spawn} from 'node:child_process';
import pg from 'pg';
const c=JSON.parse(readFileSync('.local/state/instance.json','utf8'));
const connection={host:'127.0.0.1',port:54329,user:'yoyo',password:c.database_password};
const db=new pg.Client({...connection,database:'postgres'});await db.connect();
for(const name of ['yoyo_s7_ocr_dev','yoyo_s7_ocr_test'])if(!(await db.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)await db.query('CREATE DATABASE '+name);
await db.end();
const env={...process.env,DATABASE_URL:`postgresql://yoyo:${c.database_password}@127.0.0.1:54329/yoyo_s7_ocr_dev`,TEST_DATABASE_URL:`postgresql://yoyo:${c.database_password}@127.0.0.1:54329/yoyo_s7_ocr_test`,ALLOW_TEST_RESET:'yoyo_s7_ocr_test',STATE_DIR:'.local/s7-ocr-test-state',S3_ENDPOINT:'http://127.0.0.1:59130',S3_PUBLIC_ENDPOINT:'http://127.0.0.1:59130',S3_BUCKET:'yoyo-s7-ocr-test',MEDIA_ENDPOINT:'http://127.0.0.1:59140',TEST_COMPOSE_FILE:'compose.s7-ocr-test.yaml',EVIDENCE_DIR:'docs/evidence/s7-ocr'};
async function run(cmd,args){await new Promise((resolve,reject)=>{const p=spawn(cmd,args,{env,stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(cmd+' failed')));});}
await run('node',['tools/init-state.mjs']);chmodSync('.local/s7-ocr-test-state/media/media-token',0o644);
await run('docker',['compose','-f','compose.s7-ocr-test.yaml','up','-d','--build','--wait']);
await run('pnpm',['exec','tsx','tools/storage-init.ts']);
const args=process.argv.slice(2);await run(args[0]??'pnpm',args.length?args.slice(1):['test']);
