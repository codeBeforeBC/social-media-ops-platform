import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const c=JSON.parse(readFileSync('.local/state/instance.json','utf8'));
const child=spawn('pnpm',['exec','prisma','db','pull'],{stdio:'inherit',env:{...process.env,DATABASE_URL:`postgresql://yoyo:${c.database_password}@127.0.0.1:54329/yoyo`}});
child.on('exit',code=>process.exitCode=code??1);
