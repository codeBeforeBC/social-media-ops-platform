import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const state=process.env.STATE_DIR??'.local/state';
let url=process.env.TEST_DATABASE_URL;
if(!url){const c=JSON.parse(readFileSync(state+'/instance.json','utf8'));url=`postgresql://yoyo:${c.database_password}@127.0.0.1:54329/yoyo_test`;}
if(!new URL(url).pathname.endsWith('_test'))throw new Error('Refusing non-test database');
const command=process.argv.slice(2);
const child=spawn(command[0]??'pnpm',command.length?command.slice(1):['exec','tsx','--test','--test-concurrency=1','tests/api.test.ts','tests/jobs.test.ts','tests/permissions.test.ts','tests/files.test.ts','tests/assets.test.ts','tests/s2-safety.test.ts','tests/collection.test.ts','tests/source-evidence.test.ts','tests/ai-gateway.test.ts','tests/ai-tasks.test.ts','tests/topics.test.ts','tests/briefs.test.ts','tests/ai-evaluation.test.ts','tests/xhs-reference.test.mjs'],{stdio:'inherit',env:{...process.env,TEST_DATABASE_URL:url,JOB_LEASE_SECONDS:'2',JOB_HEARTBEAT_MS:'250',NODE_ENV:'test'}});
child.on('exit',code=>process.exitCode=code??1);
