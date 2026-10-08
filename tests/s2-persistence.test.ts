import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {AddressInfo} from 'node:net';
import {GetObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {Client,server,initialize} from './helpers';
import {createApp} from '../apps/api/src/main';
import {Storage} from '../packages/domain/src/storage';
import {png,hash} from './s2-helpers';
// Explicit invocation only: restarts the isolated S2 test storage, never the use instance.
test('S2专用环境：API/存储重启续传、重建后原件/凭据持久化及签名过期', {timeout:180000},async()=>{
 assert.equal(process.env.S3_BUCKET,'yoyo-s2-test');assert.equal(process.env.S3_ENDPOINT,'http://127.0.0.1:59020');
 const credentials=hash(readFileSync('.local/s2-test-state/instance.json'));const store=new Storage();await store.init();const s=await server();let app=s.app;
 const control=(...args:string[])=>execFileSync('docker',['compose','-f','compose.test.yaml',...args],{stdio:'ignore',timeout:90000});
 const ready=async()=>{for(let n=0;n<40;n++){try{await store.init();return;}catch{await new Promise(r=>setTimeout(r,500));}}throw new Error('storage readiness timeout');};
 try{const c=new Client(s.url);await initialize(c);const original=Buffer.concat([png(),Buffer.alloc(8388608,42)]);
 const u=await c.call('/uploads','POST',{name:'重启续传.png',size_bytes:original.length,mime_hint:'image/png',purpose:'asset',sha256:hash(original)});assert.equal(u.status,201);
 const send=async(client:Client,n:number)=>{const bytes=original.subarray((n-1)*u.data.part_size,n*u.data.part_size);const p=await client.call(`/uploads/${u.data.id}/parts`,'POST',{part_number:n,checksum:hash(bytes)});assert.equal(p.status,200);const r=await fetch(client.base+p.data.upload_url,{method:'PUT',headers:{'Content-Type':'application/octet-stream',Cookie:client.cookie,Origin:'http://localhost:3000','X-CSRF-Token':client.csrf},body:new Uint8Array(bytes)});assert.equal(r.status,200);return (await r.json()).data;};
 const first=await send(c,1);await app.close();control('restart','storage');await ready();app=await createApp(s.db);await app.listen(0,'127.0.0.1');const resumed=new Client(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`);resumed.cookie=c.cookie;resumed.csrf=c.csrf;
 const pending=await resumed.call('/uploads/'+u.data.id);assert.equal(pending.status,200);assert.deepEqual(pending.data.completed_parts,[first]);const second=await send(resumed,2);const complete=await resumed.call(`/uploads/${u.data.id}/complete`,'POST',{parts_manifest:[first,second]});assert.equal(complete.status,200);
 control('up','-d','--force-recreate','--wait','storage');await ready();const link=await resumed.call(`/files/${complete.data.id}/download`);assert.equal(link.status,200);const download=await fetch(link.data.url);assert.equal(download.status,200);assert.equal(hash(Buffer.from(await download.arrayBuffer())),hash(original));assert.equal(hash(readFileSync('.local/s2-test-state/instance.json')),credentials);
 const key=(await s.db.query('SELECT object_key FROM file_objects WHERE id=$1',[complete.data.id])).rows[0].object_key;const expiry=await getSignedUrl(store.publicClient,new GetObjectCommand({Bucket:store.bucket,Key:key}),{expiresIn:1});await new Promise(r=>setTimeout(r,2100));const expired=await fetch(expiry);assert.equal(expired.status,403);await expired.arrayBuffer();
 const tampered=new URL(link.data.url);tampered.searchParams.set('X-Amz-Signature','0'.repeat(64));const denied=await fetch(tampered);assert.equal(denied.status,403);await denied.arrayBuffer();
 writeFileSync('docs/evidence/s2/persistence.json',JSON.stringify({checked_at:new Date().toISOString(),isolated_profile:'yoyo-s2-tests',api_restart_preserved_session_and_uploaded_part:true,storage_restart_preserved_multipart:true,storage_recreation_preserved_original_sha256:true,credentials_unchanged:true,expired_signed_url_403:true,tampered_signed_url_403:true,fixture:'synthetic_png_signature_with_padding_for_storage_only_not_media_compatibility',parts:2},null,2)+'\n');
 }finally{await app.close();await s.db.close();store.destroy();}
});
