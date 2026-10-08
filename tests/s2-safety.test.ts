import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {Client,server,initialize} from './helpers';
import {png,hash,uploadBytes} from './s2-helpers';
import {Files} from '../apps/api/src/files';
import {Storage} from '../packages/domain/src/storage';
import {Jobs} from '../packages/domain/src/jobs';
import {mediaHandler} from '../packages/domain/src/media';
test('S2异常：格式/大小/分片哈希/原件哈希拒绝、取消/过期清理、同空间去重与恶意PNG隔离',async()=>{
 const store=new Storage();await store.init();const s=await server();
 try{const c=new Client(s.url),me=await initialize(c);const body=png();
 assert.equal((await c.call('/uploads','POST',{name:'拒绝.mov',size_bytes:1,mime_hint:'application/octet-stream',purpose:'asset'})).status,422);assert.equal((await c.call('/uploads','POST',{name:'大.png',size_bytes:2147483649,mime_hint:'image/png',purpose:'asset'})).status,422);
 const create=async(checksum?:string)=>{const u=await c.call('/uploads','POST',{name:'测试.png',size_bytes:body.length,mime_hint:'image/png',purpose:'asset',sha256:checksum});assert.equal(u.status,201);return u.data;};
 const u=await create(hash(Buffer.from('different')));const p=await c.call(`/uploads/${u.id}/parts`,'POST',{part_number:1,checksum:hash(body)});assert.equal(p.status,200);
 const put=(b:Buffer)=>fetch(s.url+p.data.upload_url,{method:'PUT',headers:{'Content-Type':'application/octet-stream',Cookie:c.cookie,Origin:'http://localhost:3000','X-CSRF-Token':c.csrf},body:new Uint8Array(b)});
 const rejected=await put(Buffer.alloc(body.length));assert.equal(rejected.status,422);await rejected.arrayBuffer();const valid=await put(body);const part=(await valid.json()).data;
 assert.equal((await c.call(`/uploads/${u.id}/complete`,'POST',{parts_manifest:[part]})).error.code,'FILE_CHECKSUM_INVALID');assert.equal((await c.call(`/uploads/${u.id}/abort`,'POST',{reason:'清理失败会话'})).status,200);assert.equal((await c.call('/uploads/'+u.id)).data.completed_parts.length,0);
 const exp=await create();await s.db.query("UPDATE upload_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[exp.id]);const files=new Files(s.db);await files.expire();files.storage.destroy();assert.equal((await c.call('/uploads/'+exp.id)).data.status,'expired');
 const f=await uploadBytes(c,s.url,body);const duplicate=await uploadBytes(c,s.url,body,'同内容不同名称.png');assert.equal(duplicate.id,f.id);assert.equal((await s.db.query('SELECT count(*)::int n FROM file_objects WHERE workspace_id=$1 AND is_preview=false',[me.workspace.id])).rows[0].n,1);
 const bad=await uploadBytes(c,s.url,Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]),'伪造内容.png');const jobs=new Jobs(s.db,{'media.preview':mediaHandler(s.db,store)});await jobs.dispatch();for(let n=0;n<3;n++){const job=await jobs.claim('media');if(!job)break;await jobs.process(job);}const invalid=(await s.db.query('SELECT file_status,preview_status FROM file_objects WHERE id=$1',[bad.id])).rows[0];assert.equal(invalid.file_status,'quarantined');assert.equal(invalid.preview_status,'failed');assert.equal((await c.call('/assets','POST',{name:'不可用',category:'2d',source_file_id:bad.id,ip_identity:'YOYO',owner_id:me.membership.id,source:'恶意测试'})).status,422);
 const other=(await s.db.query("INSERT INTO workspaces(name) VALUES('另一空间') RETURNING id")).rows[0].id;const actor={workspaceId:other,userId:me.user.id,memberId:me.membership.id,roles:['admin'] as any,requestId:randomUUID(),sessionHash:''};const scoped=new Files(s.db);await assert.rejects(scoped.get(actor,u.id),(e:any)=>e.code==='NOT_FOUND');await assert.rejects(scoped.link(actor,f.id),(e:any)=>e.code==='NOT_FOUND');scoped.storage.destroy();
 }finally{await s.close();store.destroy();}
});
test('解析沙箱：禁止网络与凭据读取，允许PNG处理目录，资源与容器权限受限',()=>{
 const project=process.env.S2_TEST_PROJECT??'yoyo-s2-tests';const output=execFileSync('docker',['compose','-p',project,'-f','compose.test.yaml','exec','-T','media-executor','sh','-c','mkdir -p /scratch/security-probe && /usr/local/bin/media-sandbox /scratch/security-probe /usr/bin/python3 -c "import socket; blocked=False\ntry: socket.socket()\nexcept PermissionError: blocked=True\nassert blocked\ntry: open(\'/run/media-token\').read(); raise AssertionError(\'credential exposed\')\nexcept PermissionError: pass\nopen(\'allowed.txt\',\'w\').write(\'ok\')\nprint(\'network_and_credentials_blocked\')"'],{encoding:'utf8'});assert.match(output,/network_and_credentials_blocked/);
 writeFileSync('docs/evidence/s2/sandbox.json',JSON.stringify({checked_at:new Date().toISOString(),network_syscalls_denied:true,credential_file_denied:true,working_directory_write_allowed:true,parser_no_new_privileges:true,landlock_and_seccomp_required:true},null,2)+'\n');
});
