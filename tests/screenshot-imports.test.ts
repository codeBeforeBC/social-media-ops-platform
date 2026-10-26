import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {server,Client,initialize,legacyMember} from './helpers';
import {png,uploadBytes} from './file-helpers';
import {Jobs} from '../packages/domain/src/jobs';
import {Storage} from '../packages/domain/src/storage';
import {fileValidationHandler} from '../packages/domain/src/media';
import {importParseHandler} from '../packages/domain/src/imports';
let env:Awaited<ReturnType<typeof server>>,c:Client,account:any,me:any,file:any,batch:any,store:Storage,jobs:Jobs;
const metric=(value='1.2 万')=>({target:{account_id:account.id,publication_id:null},metric_key:'followers',definition_version:'1',aggregation_kind:'snapshot',value,unit:'人',observed_at:'2026-10-01T00:00:00+08:00',time_precision:'day',traffic_type:'unknown',is_approximate:false,source_definition:'明确合成后台口径',source_note:'合成边界用例，不是真实后台验收'});
before(async()=>{env=await server();c=new Client(env.url);me=await initialize(c);account=(await c.call('/accounts','POST',{name:'合成OCR边界账号',platform:'xiaohongshu',platform_user_id:'synthetic-ocr-boundary'})).data;store=new Storage();jobs=new Jobs(env.db,{'file.validate':fileValidationHandler(env.db,store),'import.parse':importParseHandler(env.db)});});
after(async()=>{store.destroy();await env.close();});
async function drain(){await jobs.dispatch();for(const pool of ['media','general'])for(let i=0;i<30;i++){const j=await jobs.claim(pool);if(!j)break;await jobs.process(j);}}
test('空白原图实际沙箱OCR保留原件和补录入口，所有识别行禁止直接确认',async()=>{
 file=await uploadBytes(c,env.url,account.id,png(),'明确合成空白.png');await drain();
 const f=(await c.call('/files/'+file.id)).data;assert.equal(f.file_status,'ready');assert.equal(f.metadata.ocr_parser_version,'ocr-v1');assert.equal(f.metadata.ocr.state,'no_text');
 const made=await c.call('/imports','POST',{account_id:account.id,file_ids:[file.id],source_type:'screenshot'});assert.equal(made.status,202,JSON.stringify(made.error));batch=made.data;await drain();
 const rotated=await uploadBytes(c,env.url,account.id,readFileSync('tests/fixtures/synthetic-ocr-rotated.jpg'),'合成方向.jpg','import_screenshot','image/jpeg');await drain();const image=(await c.call('/files/'+rotated.id)).data;assert.equal(image.metadata.width,2);assert.equal(image.metadata.height,3);
 batch=(await c.call('/imports/'+batch.id)).data;const rows=(await c.call('/imports/'+batch.id+'/rows')).data.items;assert.equal(rows.length,1);assert.equal(rows[0].raw.ocr.placeholder,true);assert.equal(rows[0].status,'excluded');
 assert.equal((await c.call('/imports/'+batch.id+'/confirm','POST',{row_ids:[rows[0].id],conflict_resolutions:[],reason:'不允许把识别成功直接入账',expected_version:batch.version})).status,422);
 assert.equal((await env.db.query('SELECT count(*)::int n FROM metric_observations')).rows[0].n,0);
});
test('人工作用区域/单位/时间/账号校验，原识别不改，万保留约数，部分确认和撤销复用',async()=>{
 const row=(await c.call('/imports/'+batch.id+'/rows')).data.items[0],region={x:0,y:0,width:1,height:1};
 assert.equal((await c.call('/import-rows/'+row.id,'PATCH',{metric:metric(),reason:'无区域',expected_version:row.version})).status,422);
 assert.equal((await c.call('/import-rows/'+row.id,'PATCH',{metric:metric(),source_region:{...region,x:100000},reason:'超界',expected_version:row.version})).status,422);
 assert.equal((await c.call('/import-rows/'+row.id,'PATCH',{metric:{...metric(),target:{account_id:randomUUID()}},source_region:region,reason:'错误账号',expected_version:row.version})).status,422);
 assert.equal((await c.call('/import-rows/'+row.id,'PATCH',{metric:{...metric(),observed_at:null},source_region:region,reason:'不能编造时间',expected_version:row.version})).status,422);
 const fixed=await c.call('/import-rows/'+row.id,'PATCH',{metric:metric(),source_region:region,reason:'合成原图人工补录，明确近似',expected_version:row.version});assert.equal(fixed.status,200,JSON.stringify(fixed.error));assert.equal(fixed.data.metric.value,'12000');assert.equal(fixed.data.metric.is_approximate,true);assert.equal(fixed.data.raw.value,'');assert.equal(fixed.data.corrections.length,1);
 batch=(await c.call('/imports/'+batch.id)).data;const confirmed=await c.call('/imports/'+batch.id+'/confirm','POST',{row_ids:[row.id],conflict_resolutions:[],reason:'确认所选行',expected_version:batch.version});assert.equal(confirmed.status,200);
 assert.equal((await c.call('/imports/'+batch.id+'/revert','POST',{reason:'合成撤销复查',expected_version:confirmed.data.version})).status,200);
 assert.equal((await env.db.query("SELECT count(*)::int n FROM metric_observations WHERE validity='confirmed'")).rows[0].n,0);
});
test('手工补充必须真实引用原图，错用途/跨账号拒绝；同工作区管理员可预览下载及更正',async()=>{
 const region={x:0,y:0,width:1,height:1};
 const made=await c.call('/imports','POST',{account_id:account.id,file_ids:[file.id],source_type:'screenshot',manual_rows:[metric('545')],source_region:region});assert.equal(made.status,202,JSON.stringify(made.error));
 const row=(await c.call('/imports/'+made.data.id+'/rows')).data.items[0];assert.equal(row.raw.ocr.mode,'manual_supplement');assert.equal(row.file_id,file.id);assert.equal(row.status,'valid');
 assert.equal((await c.call('/imports','POST',{account_id:account.id,file_ids:[file.id],source_type:'csv'})).status,422);
 const other=(await c.call('/accounts','POST',{name:'合成另账号',platform:'xiaohongshu',platform_user_id:'synthetic-ocr-other'})).data;assert.equal((await c.call('/imports','POST',{account_id:other.id,file_ids:[file.id],source_type:'screenshot'})).status,422);
 const v=new Client(env.url);await v.init();
 assert.equal((await v.call('/files/'+file.id+'/preview')).status,200);assert.equal((await v.call('/files/'+file.id+'/download')).status,200);
 assert.equal((await v.call('/import-rows/'+row.id,'PATCH',{metric:metric('546'),reason:'其他管理员更正',expected_version:row.version})).status,200);
});
test('旧图再校验按任务发起者授权，在途撤权不能借原上传者权限落库',async()=>{
 const member=await legacyMember(env.db,'ocr-legacy@example.test');const operator=new Client(env.url);await operator.init();
 await env.db.query("UPDATE file_objects SET metadata=metadata-'ocr'-'ocr_parser_version' WHERE id=$1",[file.id]);
 const reused=await uploadBytes(operator,env.url,account.id,png(),'合成旧图再识别.png');assert.equal(reused.id,file.id);await jobs.dispatch();const job=await jobs.claim('media');assert.ok(job);await env.db.query('UPDATE jobs SET created_by=$1 WHERE id=$2',[member.id,job.id]);job.created_by=member.id;
 const handled=await fileValidationHandler(env.db,store)(job,new AbortController().signal);await env.db.query("UPDATE memberships SET roles=ARRAY['viewer'] WHERE id=$1",[me.membership.id]);assert.equal(await env.db.transaction(tx=>handled.guard!(tx)),null);await env.db.query("UPDATE memberships SET roles=ARRAY['admin'] WHERE id=$1",[me.membership.id]);
 await env.db.query('UPDATE memberships SET active=false WHERE id=$1',[member.id]);assert.equal(await env.db.transaction(tx=>handled.guard!(tx)),'FILE_SCOPE_CHANGED');await handled.cleanup?.(false);
 assert.equal((await env.db.query('SELECT file_status FROM file_objects WHERE id=$1',[file.id])).rows[0].file_status,'uploading');assert.equal((await env.db.query('SELECT created_by FROM file_objects WHERE id=$1',[file.id])).rows[0].created_by,me.membership.id);
});
