import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {Client} from './helpers';
export const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export const png=()=>readFileSync('tests/fixtures/transparent.png');
export async function uploadBytes(c:Client,url:string,accountId:string,b:Buffer,name='透明中文.png',purpose='import_screenshot',mime='image/png'){
 const u=await c.call('/uploads','POST',{account_id:accountId,name,size_bytes:b.length,mime_hint:mime,purpose,sha256:hash(b)});assert.equal(u.status,201,JSON.stringify(u.error));const parts=[];
 for(let n=1;n<=Math.ceil(b.length/u.data.part_size);n++){const body=b.subarray((n-1)*u.data.part_size,n*u.data.part_size);const p=await c.call(`/uploads/${u.data.id}/parts`,'POST',{part_number:n,checksum:hash(body)});assert.equal(p.status,200);const r=await fetch(url+p.data.upload_url,{method:'PUT',headers:{'Content-Type':'application/octet-stream',Cookie:c.cookie,Origin:'http://localhost:3000','X-CSRF-Token':c.csrf},body:new Uint8Array(body)});assert.equal(r.status,200);parts.push((await r.json()).data);}
 const f=await c.call(`/uploads/${u.data.id}/complete`,'POST',{parts_manifest:parts});assert.equal(f.status,200);return f.data;
}
