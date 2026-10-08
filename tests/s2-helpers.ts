import {createHash} from 'node:crypto';
import {crc32,deflateSync} from 'node:zlib';
import {open,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import assert from 'node:assert/strict';
import {Client} from './helpers';
export const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export function png(alpha=100){const chunk=(type:string,data:Buffer)=>{const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,-4)),out.length-4);return out;};const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;const row=Buffer.from([0,49,154,255,alpha,255,198,186,255]);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat([row,row]))),chunk('IEND',Buffer.alloc(0))]);}
export async function uploadBytes(c:Client,url:string,b:Buffer,name='透明中文.png',purpose='asset'){
 const u=await c.call('/uploads','POST',{name,size_bytes:b.length,mime_hint:purpose==='asset'?'image/png':'application/pdf',purpose,sha256:hash(b)});assert.equal(u.status,201);const parts=[];
 for(let n=1;n<=Math.ceil(b.length/u.data.part_size);n++){const body=b.subarray((n-1)*u.data.part_size,n*u.data.part_size);const p=await c.call(`/uploads/${u.data.id}/parts`,'POST',{part_number:n,checksum:hash(body)});assert.equal(p.status,200);const r=await fetch(url+p.data.upload_url,{method:'PUT',headers:{'Content-Type':'application/octet-stream',Cookie:c.cookie,Origin:'http://localhost:3000','X-CSRF-Token':c.csrf},body:new Uint8Array(body)});assert.equal(r.status,200);parts.push((await r.json()).data);}
 const f=await c.call(`/uploads/${u.data.id}/complete`,'POST',{parts_manifest:parts});assert.equal(f.status,200);return f.data;
}
export async function uploadRealFile(c:Client,url:string,path:string,checkpoint?:(uid:string,part:number)=>Promise<void>){
 const info=await stat(path),digest=createHash('sha256');for await(const b of createReadStream(path))digest.update(b);const checksum=digest.digest('hex');
 const u=await c.call('/uploads','POST',{name:'YOYO完整规范-中文.pdf',size_bytes:info.size,mime_hint:'application/pdf',purpose:'guideline',sha256:checksum});assert.equal(u.status,201);const parts=[];const fd=await open(path,'r');
 try{for(let n=1;n<=Math.ceil(info.size/u.data.part_size);n++){const body=Buffer.alloc(Math.min(u.data.part_size,info.size-(n-1)*u.data.part_size));await fd.read(body,0,body.length,(n-1)*u.data.part_size);const p=await c.call(`/uploads/${u.data.id}/parts`,'POST',{part_number:n,checksum:hash(body)});assert.equal(p.status,200);const r=await fetch(url+p.data.upload_url,{method:'PUT',headers:{'Content-Type':'application/octet-stream',Cookie:c.cookie,Origin:'http://localhost:3000','X-CSRF-Token':c.csrf},body:new Uint8Array(body)});assert.equal(r.status,200);parts.push((await r.json()).data);if(checkpoint)await checkpoint(u.data.id,n);}}
 finally{await fd.close();}const f=await c.call(`/uploads/${u.data.id}/complete`,'POST',{parts_manifest:parts});assert.equal(f.status,200);assert.equal(f.data.sha256,checksum);assert.equal(f.data.size_bytes,info.size);return f.data;
}
