import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Client,server,initialize} from './helpers';
import {uploadRealFile} from './s2-helpers';
import {Storage} from '../packages/domain/src/storage';
import {Jobs} from '../packages/domain/src/jobs';
import {mediaHandler} from '../packages/domain/src/media';
import {writeFileSync} from 'node:fs';
test('真实410MB规范PDF：断点查询/登录恢复、原件哈希、37页预览/文本、规则页码与激活留痕', {timeout:1800000,skip:!process.env.S2_REAL_PDF},async()=>{
 const store=new Storage();await store.init();const s=await server();
 try{const c=new Client(s.url),me=await initialize(c);let recoveries=0;
 const f=await uploadRealFile(c,s.url,process.env.S2_REAL_PDF!,async(uid,n)=>{if(n===3){const before=await c.call('/uploads/'+uid);assert.equal(before.data.completed_parts.length,3);await c.call('/auth/logout','POST');await c.login('admin@example.test');const after=await c.call('/uploads/'+uid);assert.deepEqual(after.data.completed_parts,before.data.completed_parts);recoveries++;}});
 const jobs=new Jobs(s.db,{'media.preview':mediaHandler(s.db,store)});await jobs.dispatch();const j=await jobs.claim('media');assert.ok(j);await jobs.process(j);const actual=(await s.db.query('SELECT * FROM file_objects WHERE id=$1',[f.id])).rows[0];assert.equal(actual.preview_status,'ready');assert.equal(actual.metadata.pages,37);assert.equal(actual.metadata.pages_preview.length,37);assert.ok(actual.metadata.text.length>0);
 const link=await c.call(`/files/${f.id}/download`);const bytes=await fetch(link.data.url);const hash=createHash('sha256');for await(const b of bytes.body as any)hash.update(b);assert.equal(hash.digest('hex'),f.sha256);
 const rules=[{category:'color',rule_text:'YOYO规范色彩按原文核对',source_page:17,severity:'required',uncertainty_note:'测试规则，仅验证页码追溯，不是品牌审批'}];assert.equal((await c.call('/rule-sets','POST',{edition:'越界测试',source_file_id:f.id,rules:[{...rules[0],source_page:38}]})).status,422);
 const r=await c.call('/rule-sets','POST',{edition:'2026-合成验收规则',source_file_id:f.id,rules});assert.equal(r.status,201);const active=await c.call(`/rule-sets/${r.data.id}/activate`,'POST',{checklist:['PDF页序17，人工确认演练'],expected_version:1});assert.equal(active.status,200);assert.equal(active.data.status,'active');assert.equal(active.data.activated_by,me.membership.id);
 const second=await c.call('/rule-sets','POST',{edition:'第二版测试',source_file_id:f.id,rules});assert.equal((await c.call(`/rule-sets/${second.data.id}/activate`,'POST',{checklist:['换版验证'],expected_version:1})).status,200);assert.equal((await c.call('/rule-sets/'+r.data.id)).data.status,'retired');
 assert.equal((await c.call(`/files/${f.id}/preview?page=17`)).status,200);assert.equal((await c.call(`/files/${f.id}/preview?page=38`)).status,404);
 await s.db.query("UPDATE memberships SET roles=ARRAY['viewer'] WHERE id=$1",[me.membership.id]);const preview=await c.call(`/files/${f.id}/preview?page=17`);assert.equal(preview.status,200);assert.equal((await c.call(`/files/${f.id}/download`)).status,403);const image=await fetch(preview.data.url);assert.equal(image.status,200);await image.arrayBuffer();
 writeFileSync('docs/evidence/s2/real-pdf.json',JSON.stringify({kind:'real_provided_guideline_pdf_in_isolated_test',size_bytes:f.size_bytes,sha256:f.sha256,pages:actual.metadata.pages,pages_preview:actual.metadata.pages_preview.length,text_characters:actual.metadata.text.length,login_resume_checkpoints:recoveries,verified_original_download_sha256:true,rule_page_bounds:true,rule_activation_and_retirement:true,viewer_preview_only:true,checked_at:new Date().toISOString()},null,2)+'\n');
 }finally{await s.close();store.destroy();}
});
