import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Client,initialize,server} from './helpers';
let env:Awaited<ReturnType<typeof server>>,client:Client,me:any,account:any;
before(async()=>{env=await server();client=new Client(env.url);me=await initialize(client);account=(await client.call('/accounts','POST',{platform:'xiaohongshu',platform_user_id:'s4-controlled',name:'S4隔离测试账号'})).data;});
after(()=>env.close());
test('人工新建图文后保存逐页文案，再从详情恢复原始快照',async()=>{
 const created=await client.call('/contents','POST',{account_id:account.id,media_type:'graphic',owner_id:me.membership.id,title:'人工图文'});assert.equal(created.status,201);
 const c=(await client.call('/contents/'+created.data.id)).data;
 const pages=[{position:1,visual_instruction:'封面画面',page_copy:'封面文案',asset_version_ids:[],publish_file_id:null},{position:2,visual_instruction:'第二页',page_copy:'第二页文案',asset_version_ids:[],publish_file_id:null}];
 const saved=await client.call('/contents/'+c.id+'/revisions','POST',{base_revision_id:c.current_revision_id,expected_version:c.version,title:'修改标题',body:'人工正文',tags:['观察'],brief:{goal:'传递观察',audience:'旅行者',follow_reason:'持续观察'},pages});assert.equal(saved.status,201);
 const detail=(await client.call('/contents/'+c.id)).data;
 assert.equal(detail.current_revision.payload.title,'修改标题');assert.deepEqual(detail.current_revision.payload.pages,pages);
 assert.equal(detail.revisions.find((r:any)=>r.id===c.current_revision_id).payload.title,'人工图文');assert.equal(detail.revisions.length,2);
});
test('同一基础版本并发保存只有一个成功，恢复历史版本产生新快照',async()=>{
 const c=(await client.call('/contents','POST',{account_id:account.id,media_type:'graphic',owner_id:me.membership.id,title:'并发恢复'})).data;
 const fields={base_revision_id:c.current_revision_id,expected_version:c.version,title:'竞争标题',body:'竞争正文',tags:[],brief:{},pages:[]};
 const responses=await Promise.all([client.call('/contents/'+c.id+'/revisions','POST',fields),client.call('/contents/'+c.id+'/revisions','POST',{...fields,title:'另一编辑'})]);assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
 const latest=(await client.call('/contents/'+c.id)).data;
 const restored=await client.call('/contents/'+c.id+'/restore','POST',{source_revision_id:c.current_revision_id,base_revision_id:latest.current_revision_id,expected_version:latest.version});assert.equal(restored.status,201);
 const after=(await client.call('/contents/'+c.id)).data;assert.equal(after.current_revision.payload.title,'并发恢复');assert.notEqual(after.current_revision_id,c.current_revision_id);assert.equal(after.revisions.length,3);assert.equal(after.revisions.find((r:any)=>r.id===c.current_revision_id).frozen,true);
});
async function member(email:string,roles:string[],accountIds:string[]){
 const invited=(await client.call('/members','POST',{email,roles})).data;
 const c=new Client(env.url);await c.init();const accepted=await c.call('/auth/accept-invite','POST',{invitation_token:invited.invitation_token,password:'A-safe-test-password-987'});assert.equal(accepted.status,200);await c.login(email);return c;
}
test('运营只能修改发布文案，不能改逐页制作内容；只读不能保存',async()=>{
 const operator=await member('s4-operator@example.test',['operator'],[account.id]);const viewer=await member('s4-viewer@example.test',['viewer'],[account.id]);
 const c=(await client.call('/contents','POST',{account_id:account.id,media_type:'graphic',owner_id:me.membership.id,title:'字段权限'})).data;
 const body={base_revision_id:c.current_revision_id,expected_version:c.version,title:'运营文案',body:'发布正文',tags:[],brief:{},pages:[{position:1,visual_instruction:'运营越权',page_copy:'越权',asset_version_ids:[],publish_file_id:null}]};
 assert.equal((await operator.call('/contents/'+c.id+'/revisions','POST',body)).status,403);
 assert.equal((await viewer.call('/contents/'+c.id+'/revisions','POST',{...body,pages:[]})).status,403);
 assert.equal((await operator.call('/contents/'+c.id+'/revisions','POST',{...body,pages:[]})).status,201);
});
test('图文成品只关联同空间已上传PNG原件，无效文件和PDF不能保存为发布图片',async()=>{
 const {uploadBytes,png}=await import('./s2-helpers');const {Storage}=await import('../packages/domain/src/storage');const {readFileSync}=await import('node:fs');const store=new Storage();await store.init();
 try{
 const c=(await client.call('/contents','POST',{account_id:account.id,media_type:'graphic',owner_id:me.membership.id,title:'PNG成品关联'})).data;
 const fields={base_revision_id:c.current_revision_id,expected_version:c.version,title:c.title,body:'人工正文',tags:[],brief:{},pages:[{position:1,visual_instruction:'封面',page_copy:'封面',asset_version_ids:[],publish_file_id:'00000000-0000-4000-8000-000000000000'}]};
 assert.equal((await client.call('/contents/'+c.id+'/revisions','POST',fields)).status,422);
 const pdf=await uploadBytes(client,env.url,readFileSync('tests/fixtures/guideline.pdf'),'规范.pdf','guideline');
 assert.equal((await client.call('/contents/'+c.id+'/revisions','POST',{...fields,pages:[{...fields.pages[0],publish_file_id:pdf.id}]})).status,422);
 const file=await uploadBytes(client,env.url,png(),'图文中文成品.png');
 assert.equal((await client.call('/contents/'+c.id+'/revisions','POST',{...fields,pages:[{...fields.pages[0],publish_file_id:file.id}]})).status,201);
 const d=(await client.call('/contents/'+c.id)).data;assert.equal(d.deliverables[0].id,file.id);assert.equal(d.deliverables[0].sha256,file.sha256);assert.equal(d.deliverables[0].position,1);
 }finally{store.destroy();}
});
test('内容列表按形式、状态、负责人和计划时间过滤，非法筛选拒绝',async()=>{
 const c=(await client.call('/contents','POST',{account_id:account.id,media_type:'graphic',owner_id:me.membership.id,title:'计划筛选目标'})).data;
 assert.equal((await client.call('/contents/'+c.id,'PATCH',{expected_version:c.version,planned_publish_at:'2026-10-20T09:00:00+08:00',internal_notes:'仅内部说明'})).status,200);
 const list=await client.call('/contents?'+new URLSearchParams({account_id:account.id,media_type:'graphic',status:'draft',owner_id:me.membership.id,planned_start:'2026-10-20T00:00:00+08:00',planned_end:'2026-10-21T00:00:00+08:00'}));assert.equal(list.status,200);assert.deepEqual(list.data.items.map((x:any)=>x.id),[c.id]);
 assert.equal((await client.call('/contents?media_type=video')).data.items.length,0);assert.equal((await client.call('/contents?status=invalid')).status,422);
});
async function readyGraphic(){
 const {uploadBytes,png}=await import('./s2-helpers');const {Storage}=await import('../packages/domain/src/storage');const {Jobs}=await import('../packages/domain/src/jobs');const {mediaHandler}=await import('../packages/domain/src/media');const store=new Storage();await store.init();
 try{const file=await uploadBytes(client,env.url,png(),'审核成品.png');const jobs=new Jobs(env.db,{'media.preview':mediaHandler(env.db,store)});await jobs.dispatch();let job;while((job=await jobs.claim('media')))await jobs.process(job);
 const c=(await client.call('/contents','POST',{account_id:account.id,media_type:'graphic',owner_id:me.membership.id,title:'完整图文审核'})).data;
 const result=await client.call('/contents/'+c.id+'/revisions','POST',{base_revision_id:c.current_revision_id,expected_version:c.version,title:c.title,body:'明确合成审核正文',tags:[],brief:{},pages:[{position:1,visual_instruction:'人工设计成品',page_copy:'人工设计',asset_version_ids:[],publish_file_id:file.id}]});assert.equal(result.status,201);return result.data;
 }finally{store.destroy();}
}
test('提交审核拒绝缺失成品，完整PNG图文冻结并由有权成员显式批准',async()=>{
 const blank=(await client.call('/contents','POST',{account_id:account.id,media_type:'graphic',owner_id:me.membership.id,title:'缺成品'})).data;
 assert.equal((await client.call('/contents/'+blank.id+'/submit-review','POST',{revision_id:blank.current_revision_id,expected_version:blank.version})).status,422);
 const c=await readyGraphic();const submitted=await client.call('/contents/'+c.id+'/submit-review','POST',{revision_id:c.current_revision_id,expected_version:c.version});assert.equal(submitted.status,201);assert.equal(submitted.data.status,'pending');
 const locked=(await client.call('/contents/'+c.id)).data;assert.equal(locked.business_status,'in_review');assert.equal(locked.current_revision.frozen,true);
 const decision=await client.call('/reviews/'+submitted.data.id+'/decide','POST',{decision:'approve',checklist:['画面','文案','顺序','素材'],comment:'合成演练自审',revision_id:c.current_revision_id,expected_version:submitted.data.version});assert.equal(decision.status,200);
 const approved=(await client.call('/contents/'+c.id)).data;assert.equal(approved.business_status,'ready_to_publish');assert.equal(approved.approved_revision_id,c.current_revision_id);assert.equal(approved.reviews[0].payload_hash,approved.current_revision.payload_hash);
});
async function submitAndApprove(c:any){const s=await client.call('/contents/'+c.id+'/submit-review','POST',{revision_id:c.current_revision_id,expected_version:c.version});assert.equal(s.status,201);const r=await client.call('/reviews/'+s.data.id+'/decide','POST',{decision:'approve',checklist:['图文文件、文案、顺序、素材'],comment:'隔离测试自审',revision_id:c.current_revision_id,expected_version:s.data.version});assert.equal(r.status,200);return (await client.call('/contents/'+c.id)).data;}
const revisionFields=(c:any,overrides:any={})=>({base_revision_id:c.current_revision_id,expected_version:c.version,title:c.current_revision.payload.title,body:c.current_revision.payload.body??'',tags:c.current_revision.payload.tags??[],brief:c.current_revision.payload.brief??{},pages:c.current_revision.payload.pages??[],...overrides});
test('审核中禁止编辑，撤回和退回派生新稿；批准后改载荷重审，内部备注不使批准失效',async()=>{
 const c=await readyGraphic();const submitted=(await client.call('/contents/'+c.id+'/submit-review','POST',{revision_id:c.current_revision_id,expected_version:c.version})).data;
 let d=(await client.call('/contents/'+c.id)).data;assert.equal((await client.call('/contents/'+c.id+'/revisions','POST',revisionFields(d,{title:'审核中修改'}))).status,409);
 const withdrawn=await client.call('/reviews/'+submitted.id+'/withdraw','POST',{reason:'主动补图',expected_version:submitted.version});assert.equal(withdrawn.status,200);
 d=(await client.call('/contents/'+c.id)).data;assert.equal(d.business_status,'in_production');assert.notEqual(d.current_revision_id,c.current_revision_id);assert.equal(d.revisions.find((r:any)=>r.id===c.current_revision_id).frozen,true);
 const again=(await client.call('/contents/'+d.id+'/submit-review','POST',{revision_id:d.current_revision_id,expected_version:d.version})).data;
 const rejected=await client.call('/reviews/'+again.id+'/decide','POST',{decision:'reject',checklist:['文案'],comment:'补充事实依据',revision_id:again.revision_id,expected_version:again.version});assert.equal(rejected.status,200);
 d=(await client.call('/contents/'+d.id)).data;const approved=await submitAndApprove(d);const fixed=approved.approved_revision_id;
 assert.equal((await client.call('/contents/'+d.id,'PATCH',{internal_notes:'内部更新',planned_publish_at:'2026-10-20T00:00:00Z',expected_version:approved.version})).status,200);
 d=(await client.call('/contents/'+d.id)).data;assert.equal(d.business_status,'ready_to_publish');assert.equal(d.approved_revision_id,fixed);
 assert.equal((await client.call('/contents/'+d.id+'/revisions','POST',revisionFields(d,{title:'修改后的公开标题'}))).status,201);
 d=(await client.call('/contents/'+d.id)).data;assert.equal(d.business_status,'in_production');assert.equal(d.approved_revision_id,null);assert.equal(d.revisions.find((r:any)=>r.id===fixed).frozen,true);assert.equal(d.reviews.find((r:any)=>r.status==='approved').revision_id,fixed);
});
test('制作角色不能批准，批准与撤回并发只有一个事务成功',async()=>{
 const editor=await member('s4-editor@example.test',['editor'],[account.id]);const c=await readyGraphic();const s=(await client.call('/contents/'+c.id+'/submit-review','POST',{revision_id:c.current_revision_id,expected_version:c.version})).data;
 const decision={decision:'approve',checklist:['全部检查'],comment:'测试',revision_id:c.current_revision_id,expected_version:s.version};
 assert.equal((await editor.call('/reviews/'+s.id+'/decide','POST',decision)).status,403);
 const competing=await Promise.all([client.call('/reviews/'+s.id+'/decide','POST',decision),client.call('/reviews/'+s.id+'/withdraw','POST',{reason:'并发撤回',expected_version:s.version})]);assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
});
test('素材停用阻止批准但仍能撤回修稿，冻结历史引用保留',async()=>{
 let c=await readyGraphic();const file=c.current_revision.payload.pages[0].publish_file_id;
 let asset=(await client.call('/assets','POST',{owner_id:me.membership.id,name:'审核停用素材',category:'2d',source_file_id:file,ip_identity:'YOYO',source:'受控合成'})).data;
 asset=(await client.call('/assets/'+asset.id+'/confirm','POST',{expected_version:asset.version,usage_scope:'仅测试',checklist:['允许演练']})).data;
 c=(await client.call('/contents/'+c.id+'/revisions','POST',revisionFields(c,{pages:[{...c.current_revision.payload.pages[0],asset_version_ids:[asset.current_version_id]}]}))).data;
 const s=(await client.call('/contents/'+c.id+'/submit-review','POST',{revision_id:c.current_revision_id,expected_version:c.version})).data;
 assert.equal((await client.call('/assets/'+asset.id+'/retire','POST',{expected_version:asset.version,reason:'受控停用'})).status,200);
 assert.equal((await client.call('/reviews/'+s.id+'/decide','POST',{decision:'approve',checklist:['检查'],comment:'不可批准',revision_id:c.current_revision_id,expected_version:s.version})).status,422);
 assert.equal((await client.call('/reviews/'+s.id+'/withdraw','POST',{expected_version:s.version,reason:'移除停用素材'})).status,200);
 let d=(await client.call('/contents/'+c.id)).data;assert.equal(d.business_status,'in_production');assert.equal(d.revisions.find((r:any)=>r.id===c.current_revision_id).frozen,true);
 assert.equal((await client.call('/contents/'+d.id+'/revisions','POST',revisionFields(d,{pages:[{...d.current_revision.payload.pages[0],asset_version_ids:[]}]}))).status,201);
});
test('开始制作保存估时，取消保留理由和版本历史且不能再提审',async()=>{
 const c=(await client.call('/contents','POST',{account_id:account.id,media_type:'graphic',owner_id:me.membership.id,title:'制作取消'})).data;
 const started=await client.call('/contents/'+c.id+'/start-production','POST',{expected_version:c.version,estimated_hours:2.5});assert.equal(started.status,200);assert.equal(started.data.business_status,'in_production');assert.equal(Number(started.data.estimated_hours),2.5);
 assert.equal((await client.call('/contents/'+c.id+'/cancel','POST',{expected_version:started.data.version,reason:'本次不制作'})).status,200);
 const d=(await client.call('/contents/'+c.id)).data;assert.equal(d.business_status,'cancelled');assert.equal(d.cancellation_reason,'本次不制作');assert.equal(d.revisions.length,1);
 assert.equal((await client.call('/contents/'+c.id+'/submit-review','POST',{revision_id:d.current_revision_id,expected_version:d.version})).status,409);
});
test('发布包异步打包批准版本，下载PNG原件、页序和文案与批准内容一致',async()=>{
 const c=await submitAndApprove(await readyGraphic());
 const queued=await client.call('/contents/'+c.id+'/export-package','POST',{approved_revision_id:c.approved_revision_id});assert.equal(queued.status,202);assert.ok(queued.data.job_id);
 const {Storage}=await import('../packages/domain/src/storage');const store=new Storage();
 try{
 // Run the same persistent worker entry point against the isolated test environment.
 const {worker}=await import('../apps/worker/src/main');const running=worker(env.db,'general');
 let result:any;try{for(let n=0;n<100;n++){result=(await client.call('/export-packages/'+queued.data.id)).data;if(result?.state==='ready')break;await new Promise(r=>setTimeout(r,100));}}finally{process.emit('SIGTERM');await running;}
 assert.equal(result.state,'ready');assert.equal(result.revision_id,c.approved_revision_id);assert.equal(result.manifest.title,c.current_revision.payload.title);assert.equal(result.manifest.pages[0].file_id,c.current_revision.payload.pages[0].publish_file_id);
 const link=await client.call('/export-packages/'+result.id+'/download');assert.equal(link.status,200);const res=await fetch(link.data.url);assert.equal(res.status,200);const bytes=Buffer.from(await res.arrayBuffer());assert.equal(bytes.readUInt32LE(0),0x04034b50);assert.ok(bytes.includes(Buffer.from('manifest.json')));assert.ok(bytes.includes(Buffer.from('01.png')));assert.ok(bytes.includes(Buffer.from(c.current_revision.payload.body)));
 assert.equal((await client.call('/contents/'+c.id+'/revisions','POST',revisionFields(c,{title:'批准后更新'}))).status,201);
 assert.equal((await client.call('/export-packages/'+result.id+'/download')).status,409);
 assert.equal((await client.call('/files/'+result.file_id+'/download')).status,409);
 }finally{store.destroy();}
});
test('缺笔记ID暂存不算发布，正式登记锁定批准版本、账号和唯一笔记并持久回收事件',async()=>{
 const c=await submitAndApprove(await readyGraphic());
 const draft=await client.call('/publication-drafts','POST',{content_id:c.id,revision_id:c.approved_revision_id,partial_fields:{url:'https://www.xiaohongshu.com/explore/sandbox'},verification_note:'隔离测试缺ID'});assert.equal(draft.status,201);
 assert.equal((await client.call('/contents/'+c.id)).data.business_status,'ready_to_publish');
 const fields={content_id:c.id,account_id:account.id,approved_revision_id:c.approved_revision_id,platform_note_id:'sandbox-s4-unique',url:'https://www.xiaohongshu.com/explore/sandbox-s4-unique',published_at:new Date(Date.now()-1000).toISOString(),traffic_type:'unknown',is_campaign:false};
 assert.equal((await client.call('/publications','POST',{...fields,platform_note_id:''})).status,422);
 assert.equal((await client.call('/publications','POST',{...fields,account_id:'00000000-0000-4000-8000-000000000000'})).status,422);
 const recorded=await client.call('/publications','POST',fields);assert.equal(recorded.status,201);assert.equal(recorded.data.revision_id,c.approved_revision_id);assert.equal(recorded.data.current_revision_id,c.approved_revision_id);
 assert.equal((await client.call('/contents/'+c.id)).data.business_status,'published');
 const other=await submitAndApprove(await readyGraphic());assert.equal((await client.call('/publications','POST',{...fields,content_id:other.id,approved_revision_id:other.approved_revision_id})).status,409);
 const events=(await env.db.query("SELECT * FROM outbox WHERE event_type='publication.recorded' AND payload->>'publication_id'=$1",[recorded.data.id])).rows;assert.equal(events.length,1);assert.equal(events[0].payload.published_at,fields.published_at);
 const {Jobs}=await import('../packages/domain/src/jobs');await new Jobs(env.db).dispatch();
 assert.equal((await env.db.query('SELECT id FROM jobs WHERE outbox_id=$1',[events[0].id])).rowCount,0);
 assert.equal((await env.db.query('SELECT dispatched_at FROM outbox WHERE id=$1',[events[0].id])).rows[0].dispatched_at,null);
});
test('已发布内容派生独立修订工作项，原稿和文件归档保持不变',async()=>{
 const c=await submitAndApprove(await readyGraphic());const p=(await client.call('/publications','POST',{content_id:c.id,account_id:account.id,approved_revision_id:c.approved_revision_id,platform_note_id:'sandbox-s4-revision',url:'https://www.xiaohongshu.com/explore/sandbox-s4-revision',published_at:new Date(Date.now()-1000).toISOString(),traffic_type:'unknown',is_campaign:false})).data;
 const original=(await client.call('/contents/'+c.id)).data;
 const made=await client.call('/contents/'+c.id+'/create-revision-work-item','POST',{owner_id:me.membership.id,reason:'沙盒外部修改演练',expected_version:original.version});assert.equal(made.status,201);assert.equal(made.data.supersedes_content_id,c.id);assert.equal(made.data.business_status,'draft');
 const work=(await client.call('/contents/'+made.data.id)).data;assert.notEqual(work.current_revision_id,c.current_revision_id);assert.equal(work.deliverables[0].id,c.deliverables[0].id);
 assert.equal((await client.call('/contents/'+c.id)).data.business_status,'published');
 const archive=(await client.call('/publications/'+p.id)).data;assert.equal(archive.revision_id,c.approved_revision_id);assert.equal(archive.deliverables[0].id,c.deliverables[0].id);
});
test('外部编辑必须关联重新批准的修订工作项，初次版本不变并拒绝重复并发确认',async()=>{
 const c=await submitAndApprove(await readyGraphic());const p=(await client.call('/publications','POST',{content_id:c.id,account_id:account.id,approved_revision_id:c.approved_revision_id,platform_note_id:'sandbox-s4-edit',url:'https://www.xiaohongshu.com/explore/sandbox-s4-edit',published_at:new Date(Date.now()-1000).toISOString(),traffic_type:'unknown',is_campaign:false})).data;
 const old=(await client.call('/contents/'+c.id)).data;const work=(await client.call('/contents/'+c.id+'/create-revision-work-item','POST',{owner_id:me.membership.id,reason:'沙盒改稿',expected_version:old.version})).data;
 let d=(await client.call('/contents/'+work.id)).data;
 const change={kind:'edited',evidence:'隔离测试人工核对',actual_revision_id:d.current_revision_id,occurred_at:new Date(Date.now()-1000).toISOString(),expected_version:p.version};
 assert.equal((await client.call('/publications/'+p.id+'/changes','POST',change)).status,409);
 d=(await client.call('/contents/'+work.id+'/revisions','POST',revisionFields(d,{title:'外部修改后的标题'}))).data;d=await submitAndApprove(d);
 const results=await Promise.all([client.call('/publications/'+p.id+'/changes','POST',{...change,actual_revision_id:d.approved_revision_id}),client.call('/publications/'+p.id+'/changes','POST',{...change,actual_revision_id:d.approved_revision_id})]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const actual=(await client.call('/publications/'+p.id)).data;assert.equal(actual.revision_id,c.approved_revision_id);assert.equal(actual.current_revision_id,d.approved_revision_id);assert.equal(actual.changes.length,1);assert.equal((await client.call('/contents/'+work.id)).data.business_status,'published');assert.equal((await client.call('/contents/'+c.id)).data.approved_revision_id,c.approved_revision_id);
});
test('删除保留发布历史，重发必须登记同账号新笔记并单独关联',async()=>{
 const original=await submitAndApprove(await readyGraphic());const fields={account_id:account.id,url:'https://www.xiaohongshu.com/explore/sandbox-delete',published_at:new Date(Date.now()-1000).toISOString(),traffic_type:'unknown',is_campaign:false};
 const p=(await client.call('/publications','POST',{...fields,content_id:original.id,approved_revision_id:original.approved_revision_id,platform_note_id:'sandbox-delete'})).data;
 const change={kind:'deleted',evidence:'沙盒模拟删除确认',occurred_at:new Date(Date.now()-500).toISOString(),expected_version:p.version};
 assert.equal((await client.call('/publications/'+p.id+'/changes','POST',change)).status,201);
 let archived=(await client.call('/publications/'+p.id)).data;assert.equal(archived.lifecycle,'deleted');assert.equal(archived.revision_id,original.approved_revision_id);assert.equal(archived.deliverables.length,1);assert.equal(archived.changes[0].kind,'deleted');
 assert.equal((await client.call('/publications/'+p.id+'/changes','POST',{...change,expected_version:archived.version})).status,409);
 const c=(await client.call('/contents/'+original.id)).data;const w=(await client.call('/contents/'+c.id+'/create-revision-work-item','POST',{owner_id:me.membership.id,reason:'沙盒重发',expected_version:c.version})).data;const next=await submitAndApprove((await client.call('/contents/'+w.id)).data);
 const re=(await client.call('/publications','POST',{...fields,content_id:next.id,approved_revision_id:next.approved_revision_id,platform_note_id:'sandbox-repost-new'})).data;assert.ok(re.id);
 const repost={kind:'reposted',evidence:'沙盒新ID核对',reposted_publication_id:re.id,occurred_at:new Date().toISOString(),expected_version:archived.version};
 assert.equal((await client.call('/publications/'+p.id+'/changes','POST',{...repost,reposted_publication_id:p.id})).status,422);
 assert.equal((await client.call('/publications/'+p.id+'/changes','POST',repost)).status,201);
 archived=(await client.call('/publications/'+p.id)).data;assert.equal(archived.lifecycle,'deleted');assert.deepEqual(archived.changes.map((r:any)=>r.kind),['deleted','reposted']);assert.equal(archived.changes[1].reposted_publication_id,re.id);
});
test('品牌辅助检查给出可追溯建议，不改变审核或自动批准',async()=>{
 const c=await readyGraphic();const result=await client.call('/contents/'+c.id+'/check','POST',{revision_id:c.current_revision_id});assert.equal(result.status,200);assert.equal(result.data.advisory_only,true);assert.equal(result.data.revision_id,c.current_revision_id);assert.ok(Array.isArray(result.data.suggestions));assert.equal((await client.call('/contents/'+c.id)).data.business_status,'draft');
});
test('取消发布包后可对同一批准版本重新排队，内容取消同时终止待处理导出',async()=>{
 const c=await submitAndApprove(await readyGraphic());let e=(await client.call('/contents/'+c.id+'/export-package','POST',{approved_revision_id:c.approved_revision_id})).data;
 assert.equal((await client.call('/jobs/'+e.job_id+'/cancel','POST',{reason:'隔离取消演练'})).status,200);assert.equal((await client.call('/export-packages/'+e.id)).data.state,'cancelled');
 const next=await client.call('/contents/'+c.id+'/export-package','POST',{approved_revision_id:c.approved_revision_id});assert.equal(next.status,202);assert.equal(next.data.id,e.id);assert.notEqual(next.data.job_id,e.job_id);assert.equal((await client.call('/jobs/'+next.data.job_id)).data.state,'queued');
 assert.equal((await client.call('/contents/'+c.id+'/cancel','POST',{reason:'隔离内容取消',expected_version:c.version})).status,200);assert.equal((await client.call('/jobs/'+next.data.job_id)).data.state,'cancelled');assert.equal((await client.call('/contents/'+c.id+'/export-package','POST',{approved_revision_id:c.approved_revision_id})).status,409);
});
test('当前素材新版本待确认时，已确认且未过期的历史版本仍可用于审核',async()=>{
 let c=await readyGraphic();const file=c.current_revision.payload.pages[0].publish_file_id;
 let asset=(await client.call('/assets','POST',{owner_id:me.membership.id,name:'有效历史素材',category:'2d',source_file_id:file,ip_identity:'YOYO',source:'隔离演练'})).data;
 asset=(await client.call('/assets/'+asset.id+'/confirm','POST',{expected_version:asset.version,usage_scope:'技术验收',checklist:['有效历史范围']})).data;const historical=asset.current_version_id;
 const next=await client.call('/assets/'+asset.id+'/versions','POST',{source_file_id:file,usage_scope:'新版本待核对',dependencies:[],base_version:asset.version});assert.equal(next.status,201);
 c=(await client.call('/contents/'+c.id+'/revisions','POST',revisionFields(c,{pages:[{...c.current_revision.payload.pages[0],asset_version_ids:[historical]}]}))).data;
 const approved=await submitAndApprove(c);assert.equal(approved.business_status,'ready_to_publish');assert.equal(approved.current_revision.payload.pages[0].asset_version_ids[0],historical);assert.equal(approved.asset_references.find((r:any)=>r.asset_version_id===historical).name,'有效历史素材');assert.equal(approved.asset_references.find((r:any)=>r.asset_version_id===historical).version_no,2);
});
