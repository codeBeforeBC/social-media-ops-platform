import {spawn} from 'node:child_process';
import {chmodSync} from 'node:fs';
const name=new URL(process.env.TEST_DATABASE_URL??'postgresql://unused@localhost/unused').pathname.slice(1);
if(name!=='yoyo_s7_test'||process.env.ALLOW_TEST_RESET!==name)throw new Error('Run through tools/s7/env.mjs; only disposable yoyo_s7_test is allowed');
const env={...process.env,STATE_DIR:'.local/s7-test-state',S3_ENDPOINT:'http://127.0.0.1:59070',S3_PUBLIC_ENDPOINT:'http://127.0.0.1:59070',S3_BUCKET:'yoyo-s7-test',MEDIA_ENDPOINT:'http://127.0.0.1:59080',TEST_COMPOSE_FILE:'compose.s7-test.yaml',EVIDENCE_DIR:'docs/evidence/s7',CONTRACT_VALIDATION_REPORT:'docs/evidence/s7/contract-validation.json'};
async function run(cmd,args){await new Promise((resolve,reject)=>{const p=spawn(cmd,args,{stdio:'inherit',env});p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(new Error(`${cmd} failed (${c})`)));});}
await run('node',['tools/init-state.mjs']);chmodSync('.local/s7-test-state/media/media-token',0o644);
await run('docker',['compose','-f','compose.s7-test.yaml','up','-d','--build','--wait']);
await run('pnpm',['exec','tsx','tools/storage-init.ts']);
await run('python3',['tools/s0/generate-contracts.py']);
await run(process.env.CONTRACT_PYTHON??'python3',['tools/s0/validate-contracts.py']);
await run('pnpm',['check']);
await run('pnpm',['exec','playwright','test']);
