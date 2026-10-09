import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Client,initialize,server} from './helpers';
import {Collection} from '../packages/domain/src/collection';
import {SourceEvidence,saveSourceItems} from '../packages/domain/src/source-evidence';
import {validateSourceResult,weiboCollector} from '../packages/domain/src/source-adapters';
import {Jobs} from '../packages/domain/src/jobs';
let env:Awaited<ReturnType<typeof server>>,client:Client,connection:any,me:any,ids:string[]=[];
before(async()=>{env=await server();client=new Client(env.url);me=await initialize(client);connection=(await client.call('/source-connections','POST',{platform:'xiaohongshu',source_type:'xhs_quality_note',provider:'opencli',name:'受控来源',enabled:true,config:{keywords:['旅行'],profile:'test-profile'},schedule:[]})).data;});
after(()=>env.close());
const item=(i:number,at=new Date().toISOString())=>({external_id:'test-note-'+i,canonical_url:'https://www.xiaohongshu.com/explore/'+String(i).padStart(24,'0'),actual_source_type:'search',title:'受控旅行参考 '+i,summary:'合成测试文本，非真实平台数据',author:null,published_at:null,date_label_raw:'原始日期未提供',captured_at:at,media_type:'image',visible_counts:{likes:{raw:'1.2万',value:12000,approximate:true}},rank:null,reference_only:true as const});
const result=(items:any[])=>validateSourceResult({items,coverage:{actual_source_type:'search',test_only:true},warnings:[],capabilities:{list_items:true,read_detail:true,read_comments:false,historical_metrics:false,own_account_metrics:false},adapter_version:'controlled-v1'});
async function run(items:any[]){await env.db.query('UPDATE source_connections SET last_attempt_at=NULL WHERE id=$1',[connection.id]);const r=await client.call(`/source-connections/${connection.id}/refresh`,'POST');assert.equal(r.status,202);const collections=new Collection(env.db,{xhs_quality_note:async()=>result(items)},saveSourceItems);const jobs=new Jobs(env.db,{'source.collect':collections.handler});await jobs.dispatch();const job=(await jobs.claim('general'))!;await jobs.process(job);assert.equal((await env.db.query('SELECT state FROM jobs WHERE id=$1',[job.id])).rows[0].state,'succeeded');return r.data.run;}
test('来源ID去重与不可变观察快照，缺发布时间不使用采集时间替代',async()=>{
 await run([item(1),item(1)]);let list=(await client.call('/source-items')).data;assert.equal(list.items.length,1);const first=list.items[0];ids=[first.id];assert.equal(first.published_at,null);assert.equal(first.reference_only,true);assert.equal(first.actual_source_type,'search');
 await run([{...item(1),summary:'第二次明确合成的观察'}]);const detail=(await client.call('/source-items/'+first.id)).data;assert.equal(detail.observations.length,2);assert.ok(detail.observations.some((r:any)=>r.payload.summary==='合成测试文本，非真实平台数据'));assert.equal(detail.visible_counts.likes.approximate,true);
 await assert.rejects(env.db.query("UPDATE source_observations SET payload='{}' WHERE source_item_id=$1",[first.id]),/Immutable/);
});
test('过期与常青筛选区分；分页游标无重复；精确标题聚类保留独立证据',async()=>{
 await run([item(2),item(3),item(4)]);const first=(await client.call('/source-items?limit=2')).data;assert.equal(first.items.length,2);assert.ok(first.next_cursor);const second=(await client.call('/source-items?limit=2&cursor='+encodeURIComponent(first.next_cursor))).data;assert.equal(second.items.length,2);assert.equal(new Set([...first.items,...second.items].map(i=>i.id)).size,4);
 assert.equal((await client.call('/source-items?freshness=invalid')).status,422);assert.equal((await client.call('/source-items?keyword='+encodeURIComponent('第二次'))).data.items.length,1);
 await env.db.query("UPDATE source_items SET captured_at=now()-interval '2 days' WHERE id=$1",[ids[0]]);assert.equal((await client.call('/source-items?freshness=expired')).data.items.length,0);
 await env.db.query("UPDATE source_connections SET source_type='xhs_topic_signal' WHERE id=$1",[connection.id]);assert.equal((await client.call('/source-items?freshness=expired')).data.items.length,1);assert.equal((await client.call('/source-items?freshness=fresh')).data.items.length,3);
});
test('过期采集不会覆盖较新的原文；跨空间查证据不可见',async()=>{
 await env.db.query("UPDATE source_connections SET source_type='xhs_quality_note' WHERE id=$1",[connection.id]);const current=(await client.call('/source-items?keyword='+encodeURIComponent('受控旅行参考 2'))).data.items[0];await run([{...item(2,'2020-01-01T00:00:00Z'),summary:'历史观察不覆盖当前'}]);const detail=(await client.call('/source-items/'+current.id)).data;assert.equal(detail.summary,current.summary);assert.equal(detail.observations.length,2);
 const other=(await env.db.query("INSERT INTO workspaces(name) VALUES('隔离空间') RETURNING id")).rows[0].id;const actor={workspaceId:other,memberId:me.membership.id,userId:me.user.id,roles:['admin'] as ['admin'],sessionHash:'',requestId:crypto.randomUUID()};await assert.rejects(new SourceEvidence(env.db).detail(actor,current.id),{code:'NOT_FOUND'});assert.equal((await new SourceEvidence(env.db).list(actor,{})).items.length,0);
});
test('签名URL、未知类型、伪造数值/日期和超量结果全部拒绝',()=>{
 assert.throws(()=>result([{...item(1),canonical_url:item(1).canonical_url+'?xsec_token=secret'}]),{code:'SOURCE_CHANGED'});
 assert.throws(()=>result([{...item(1),canonical_url:'http://127.0.0.1/admin'}]),{code:'SOURCE_CHANGED'});
 assert.throws(()=>result([{...item(1),actual_source_type:'official_xhs_hot_rank'}]),{code:'SOURCE_CHANGED'});
 assert.throws(()=>result([{...item(1),published_at:'yesterday'}]),{code:'SOURCE_CHANGED'});
 assert.throws(()=>result([{...item(1),visible_counts:{likes:{raw:'负数',value:-2,approximate:false}}}]),{code:'SOURCE_CHANGED'});
 assert.throws(()=>result(Array.from({length:51},(_,i)=>item(i))),{code:'SOURCE_CHANGED'});
});

test('微博上游额外条目不误判结构变化，按配置限额返回并保留真实上游条数',async()=>{
 const old=globalThis.fetch;try{globalThis.fetch=async()=>new Response(JSON.stringify({ok:1,data:{band_list:Array.from({length:51},(_,i)=>({word:'合成榜单条目 '+i,realpos:i+1,num:100+i,onboard_time:1000}))}}),{status:200,headers:{'Content-Type':'application/json'}});const r=await weiboCollector({config:{max_items:3}},new AbortController().signal);assert.equal(r.items.length,3);assert.equal(r.coverage.source_list_size,51);assert.equal(r.coverage.returned_items,3);assert.ok(r.items.every(i=>i.published_at===null));}finally{globalThis.fetch=old;}
});

test('跨连接同标题主题保留两条独立来源与原始观察，不按标题删除',async()=>{
 const c=(await client.call('/source-connections','POST',{platform:'xiaohongshu',source_type:'xhs_quality_note',provider:'opencli',name:'第二个受控来源',enabled:true,schedule:[]})).data;const runId=(await env.db.query("INSERT INTO collection_runs(workspace_id,connection_id,created_by,connection_version,trigger,state) VALUES($1,$2,$3,$4,'manual','succeeded') RETURNING id",[c.workspace_id,c.id,c.owner_id,c.version])).rows[0].id;await env.db.transaction(tx=>saveSourceItems(tx,c,runId,result([{...item(2),external_id:'other-connection-note'}])));const list=(await client.call('/source-items?keyword='+encodeURIComponent('受控旅行参考 2'))).data.items;assert.equal(list.length,2);assert.ok(list.every((i:any)=>i.cluster_size===2));assert.notEqual(list[0].id,list[1].id);assert.notEqual(list[0].connection_id,list[1].connection_id);
});
