import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {crc32} from 'node:zlib';
import {Client,server,initialize} from './helpers';
import {Storage} from '../packages/domain/src/storage';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
test('S2真实存储：分片重复/恢复、清单及哈希校验、私有下载、角色与跨空间隔离',async()=>{
 const store=new Storage();await store.init();const s=await server();
 try{
  const c=new Client(s.url),me=await initialize(c);const png=readFileSync('docs/yoyo-workbench-v1.0/references/brand/page-17.png');const text=Buffer.concat([Buffer.from('test\0'),Buffer.alloc(8388608,65)]),chunk=Buffer.alloc(text.length+12);chunk.writeUInt32BE(text.length);chunk.write('tEXt',4);text.copy(chunk,8);chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);const bytes=Buffer.concat([png.subarray(0,-12),chunk,png.subarray(-12)]);
  const created=await c.call('/uploads','POST',{name:'中文-原件.png',size_bytes:bytes.length,mime_hint:'application/octet-stream',purpose:'asset',sha256:sha(bytes)});assert.equal(created.status,201);const u=created.data;assert.equal(u.completed_parts.length,0);
  const parts=[];for(let n=1;n<=2;n++){
   const b=bytes.subarray((n-1)*8388608,n*8388608),checksum=sha(b);const p=await c.call(`/uploads/${u.id}/parts`,'POST',{part_number:n,checksum});assert.equal(p.status,200);
   const headers={'Content-Type':'application/octet-stream',Cookie:c.cookie,Origin:'http://localhost:3000','X-CSRF-Token':c.csrf};
   const put=await fetch(s.url+p.data.upload_url,{method:'PUT',headers,body:b});assert.equal(put.status,200);const result=(await put.json()).data;parts.push(result);
   const repeat=await fetch(s.url+p.data.upload_url,{method:'PUT',headers,body:b});assert.deepEqual((await repeat.json()).data,result);
   const state=await c.call(`/uploads/${u.id}`);assert.equal(state.data.completed_parts.length,n);
  }
  const conflict=await c.call(`/uploads/${u.id}/parts`,'POST',{part_number:1,checksum:sha(Buffer.from('bad'))});assert.equal(conflict.status,409);
  assert.equal((await c.call(`/uploads/${u.id}/complete`,'POST',{parts_manifest:parts.slice(0,1)})).status,422);
  const done=await c.call(`/uploads/${u.id}/complete`,'POST',{parts_manifest:parts});assert.equal(done.status,200);assert.equal(done.data.sha256,sha(bytes));assert.equal(done.data.size_bytes,bytes.length);
  const download=await c.call(`/files/${done.data.id}/download`);assert.equal(download.status,200);
  const downloaded=Buffer.from(await (await fetch(download.data.url)).arrayBuffer());assert.equal(sha(downloaded),sha(bytes));
  const unsigned=new URL(download.data.url);unsigned.search='';assert.equal((await fetch(unsigned)).status,403);
  assert.equal((await c.call(`/files/${done.data.id}/preview`)).status,409);
  await s.db.query("UPDATE memberships SET roles=ARRAY['viewer'] WHERE id=$1",[me.membership.id]);assert.equal((await c.call(`/files/${done.data.id}/download`)).status,403);assert.equal((await c.call('/uploads','POST',{name:'x.png',size_bytes:1,mime_hint:'image/png',purpose:'asset'})).status,403);
  await s.db.query("UPDATE memberships SET roles=ARRAY['admin'] WHERE id=$1",[me.membership.id]);
  const other=(await s.db.query("INSERT INTO workspaces(name) VALUES('isolated') RETURNING id")).rows[0].id;
  // A second workspace actor cannot see the original, even with administrator role.
  await s.db.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['admin'])",[other,me.user.id]);const foreign=new Client(s.url);await foreign.init();assert.equal((await foreign.call('/auth/login','POST',{email:'admin@example.test',password:'A-safe-test-password-987',workspace_id:other})).status,200);assert.equal((await foreign.call(`/uploads/${u.id}`)).status,404);assert.equal((await foreign.call(`/files/${done.data.id}/download`)).status,404);
  const {Files}=await import('../apps/api/src/files');const files=new Files(s.db);await assert.rejects(files.file(s.db,{workspaceId:other,userId:me.user.id,memberId:me.membership.id,roles:['admin'],sessionHash:'',requestId:randomUUID()},done.data.id),(e:any)=>e.code==='NOT_FOUND');files.storage.destroy();
 }finally{await s.close();store.destroy();}
});
