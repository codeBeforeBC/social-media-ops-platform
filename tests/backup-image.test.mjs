import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
function fixture(noImage=false){
 const dir=mkdtempSync(join(tmpdir(),'yoyo-backup-image-')),log=join(dir,'calls');
 writeFileSync(join(dir,'docker'),`#!${process.execPath}
const fs=require('fs'),a=process.argv.slice(2),s=a.join(' ');fs.appendFileSync(process.env.MOCK_LOG,JSON.stringify(a)+'\\n');
if(a[0]==='image'&&a[1]==='inspect'){process.exit(a[2]==='snapshot-image'&&!process.env.MOCK_NO_IMAGE?0:1);}
if(s.endsWith('ps --services --status running'))console.log('db\\napi\\nstorage');
else if(s.endsWith('ps -q db'))console.log('database-container');
else if(s.endsWith('images -q api'))console.log('sha256:missing-running-image');
else if(s.endsWith('config --images api'))console.log('snapshot-image');
else if(s.includes('pg_dump'))process.stdout.write('explicit-synthetic-database-dump');
else if(s.endsWith('ps -aq init'))console.log('init-container');
else if(s.endsWith('ps -aq storage'))console.log('storage-container');
else if(s.endsWith('ps -aq proxy')){}
else if(s.endsWith('ps -aq'))console.log('api-container');
else if(a[0]==='inspect'&&s.includes('Destination'))console.log(s.includes('/state')?'private-state-volume':'private-object-volume');
else if(a[0]==='inspect')console.log(JSON.stringify({Container:'synthetic',Image:'missing-original-reference',ImageID:'sha256:missing-running-image'}));
else if(a[0]==='run')process.stdout.write('explicit-synthetic-tar-stream');
`,{mode:0o700});
 const destination=join(dir,'backup'),r=spawnSync('sh',['tools/s9/backup.sh','synthetic-project',destination,'compose.yaml'],{encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,MOCK_LOG:log,...(noImage?{MOCK_NO_IMAGE:'1'}:{})}});
 const calls=readFileSync(log,'utf8').trim().split('\n').map(s=>JSON.parse(s));return {dir,destination,r,calls};
}
test('备份能从缺失的运行镜像清单切到本地快照镜像，导出并校验后恢复服务',()=>{
 const f=fixture();try{assert.equal(f.r.status,0,f.r.stderr);const runs=f.calls.filter(a=>a[0]==='run');assert.equal(runs.length,2);assert.ok(runs.every(a=>a.includes('snapshot-image')&&!a.includes('sha256:missing-running-image')));
 for(const line of readFileSync(join(f.destination,'SHA256SUMS'),'utf8').trim().split('\n')){const [sum,name]=line.trim().split(/\s+/);assert.equal(createHash('sha256').update(readFileSync(join(f.destination,name))).digest('hex'),sum);}
 const stopped=f.calls.findIndex(a=>a.includes('stop')),dumped=f.calls.findIndex(a=>a.includes('pg_dump')),started=f.calls.findIndex(a=>a.includes('start'));assert.ok(stopped>=0&&dumped>stopped&&started>dumped);assert.ok(f.calls[started].includes('api'));
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('没有可用本地快照镜像时备份提前退出，不停止运行服务',()=>{const f=fixture(true);try{assert.notEqual(f.r.status,0);assert.ok(!f.calls.some(a=>a.includes('stop')));}finally{rmSync(f.dir,{recursive:true,force:true});}});
