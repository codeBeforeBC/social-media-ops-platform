import {spawn} from 'node:child_process';
const tasks=[['pnpm',['dev:api']],['pnpm',['dev:web']],['pnpm',['worker']],['pnpm',['scheduler']],['pnpm',['worker'],{WORKER_POOL:'media'}]];
const children=tasks.map(([cmd,args,env])=>spawn(cmd,args,{stdio:'inherit',env:{...process.env,...env}}));
let stopping=false;
function stop(code){if(stopping)return;stopping=true;children.forEach(p=>p.kill('SIGTERM'));setTimeout(()=>process.exit(code),500).unref();}
children.forEach(p=>p.on('exit',code=>stop(code??1)));
process.on('SIGINT',()=>stop(0));process.on('SIGTERM',()=>stop(0));
