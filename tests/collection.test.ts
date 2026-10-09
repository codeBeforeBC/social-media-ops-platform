import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Client,initialize,server} from './helpers';
import {Collection,SourceFailure,Collector} from '../packages/domain/src/collection';
import {Jobs} from '../packages/domain/src/jobs';
let env:Awaited<ReturnType<typeof server>>,client:Client,me:any;
before(async()=>{env=await server();client=new Client(env.url);me=await initialize(client);});
after(()=>env.close());
async function create(extra:Record<string,unknown>={}){const r=await client.call('/source-connections','POST',{platform:'weibo',source_type:'weibo_hot',provider:'weibo_web',name:'测试来源',enabled:true,min_interval_seconds:60,...extra});assert.equal(r.status,201);return r.data;}
const success:Collector=async()=>({items:[],coverage:{type:'controlled_test'},adapter_version:'test-v1',capabilities:{list_items:true,read_detail:false}});
async function process(adapter:Collector=success){const collection=new Collection(env.db,{weibo_hot:adapter});const jobs=new Jobs(env.db,{'source.collect':collection.handler});await jobs.dispatch();const j=await jobs.claim('general');assert.ok(j);await jobs.process(j!);return (await env.db.query('SELECT * FROM jobs WHERE id=$1',[j!.id])).rows[0];}
test('同源并发刷新复用一个运行，事务Outbox持久化，能力来自实际执行',async()=>{
 const c=await create();const responses=await Promise.all([client.call(`/source-connections/${c.id}/refresh`,'POST'),client.call(`/source-connections/${c.id}/refresh`,'POST')]);
 assert.ok(responses.every(r=>r.status===202));assert.equal(responses[0]!.data.run.id,responses[1]!.data.run.id);
 assert.equal((await env.db.query('SELECT count(*)::int n FROM collection_runs WHERE connection_id=$1',[c.id])).rows[0].n,1);
 const job=await process();assert.equal(job.state,'succeeded');const latest=(await client.call(`/source-connections/${c.id}`)).data;assert.equal(latest.health,'healthy');assert.equal(latest.capabilities.list_items,true);
 assert.equal((await client.call(`/source-connections/${c.id}/refresh`,'POST')).status,429);
});
test('配置版本冲突拒绝覆盖；禁用时手动刷新受守卫，验证入口可用',async()=>{
 const c=await create({enabled:false});assert.equal((await client.call(`/source-connections/${c.id}/refresh`,'POST')).error.code,'SOURCE_PAUSED');
 assert.equal((await client.call(`/source-connections/${c.id}`,'PATCH',{expected_version:99,name:'覆盖'})).status,409);
 assert.equal((await client.call(`/source-connections/${c.id}/verify`,'POST')).status,202);await process();
 const latest=(await client.call(`/source-connections/${c.id}`)).data;assert.equal(latest.enabled,false);assert.equal(latest.health,'healthy');
});
test('登录失效立即暂停且通知负责人；成功验证恢复，其他来源不受影响',async()=>{
 const bad=await create(),good=await create();await client.call(`/source-connections/${bad.id}/refresh`,'POST');const job=await process(async()=>{throw new SourceFailure('AUTH_REQUIRED');});assert.equal(job.state,'failed');assert.equal(job.error_code,'AUTH_REQUIRED');
 let c=(await client.call(`/source-connections/${bad.id}`)).data;assert.equal(c.paused,true);assert.equal(c.health,'auth_required');
 assert.equal((await env.db.query('SELECT recipient_id FROM notifications WHERE job_id=$1',[job.id])).rows[0].recipient_id,me.membership.id);
 assert.equal((await client.call(`/source-connections/${bad.id}/refresh`,'POST')).status,409);
 await client.call(`/source-connections/${good.id}/refresh`,'POST');await process();assert.equal((await client.call(`/source-connections/${good.id}`)).data.health,'healthy');
 await env.db.query("UPDATE source_connections SET last_attempt_at=now()-interval '2 minutes' WHERE id=$1",[bad.id]);await client.call(`/source-connections/${bad.id}/verify`,'POST');await process();c=(await client.call(`/source-connections/${bad.id}`)).data;assert.equal(c.paused,false);assert.equal(c.consecutive_failures,0);
});
test('连续三次普通失败暂停；有界部分成功保留partial而非伪装成功',async()=>{
 const c=await create();for(let i=0;i<3;i++){await env.db.query('UPDATE source_connections SET last_attempt_at=NULL WHERE id=$1',[c.id]);assert.equal((await client.call(`/source-connections/${c.id}/refresh`,'POST')).status,202);await process(async()=>{throw new SourceFailure('SOURCE_CHANGED');});}
 assert.equal((await client.call(`/source-connections/${c.id}`)).data.paused,true);
 const partial=await create();await client.call(`/source-connections/${partial.id}/refresh`,'POST');assert.equal((await process(async()=>({...await success(partial,new AbortController().signal),warnings:['DETAIL_TIMEOUT'],captured_at:new Date().toISOString(),next_cursor:null,quota_state:{provider_limit_known:false,provider_remaining:null,request_item_limit:3}}))).state,'partial');
 const run=(await client.call(`/source-connections/${partial.id}/runs`)).data.items[0];assert.equal(run.state,'partial');assert.equal(run.coverage.quota_state.provider_remaining,null);assert.equal(run.coverage.quota_state.request_item_limit,3);assert.equal(run.coverage.next_cursor,null);assert.ok(run.coverage.batch_captured_at);assert.equal((await client.call(`/source-connections/${partial.id}`)).data.health,'degraded');
});
test('定时并发扫描同窗口只创建一次，窗口外不补写成功；改配置拒绝旧结果',async()=>{
 const c=await create({schedule:['09:00']});const collection=new Collection(env.db);await Promise.all([collection.tick(new Date('2026-10-09T01:00:00Z')),collection.tick(new Date('2026-10-09T01:00:00Z'))]);
 const runs=await env.db.query('SELECT * FROM collection_runs WHERE connection_id=$1',[c.id]);assert.equal(runs.rowCount,1);assert.equal(runs.rows[0].scheduled_slot,'2026-10-09T09:00@Asia/Shanghai');
 await client.call(`/source-connections/${c.id}`,'PATCH',{name:'新配置',expected_version:1});await process();assert.equal((await client.call(`/source-connections/${c.id}/runs`)).data.items[0].state,'cancelled');
 await collection.tick(new Date('2026-10-10T01:05:00Z'));assert.equal((await env.db.query('SELECT count(*)::int n FROM collection_runs WHERE connection_id=$1',[c.id])).rows[0].n,1);
});
test('取消同步释放同源占用；来源连接按空间隔离；无效配置拒绝',async()=>{
 const c=await create();const run=(await client.call(`/source-connections/${c.id}/refresh`,'POST')).data.run;const jobs=new Jobs(env.db);await jobs.dispatch();const job=(await env.db.query("SELECT * FROM jobs WHERE input->>'run_id'=$1",[run.id])).rows[0];await client.call(`/jobs/${job.id}/cancel`,'POST',{reason:'受控测试'});await new Collection(env.db).tick();assert.equal((await client.call(`/source-connections/${c.id}/runs`)).data.items[0].state,'cancelled');
 const other=(await env.db.query("INSERT INTO workspaces(name) VALUES('其他空间') RETURNING id")).rows[0].id;
 const actor={workspaceId:other,memberId:me.membership.id,userId:me.user.id,roles:['admin'] as ['admin'],sessionHash:'',requestId:crypto.randomUUID()};await assert.rejects(new Collection(env.db).scope(env.db,actor,c.id),{code:'NOT_FOUND'});
 assert.equal((await client.call(`/source-connections/${c.id}`,'PATCH',{expected_version:1,schedule:['25:00']})).status,422);
 assert.equal((await client.call('/source-connections','POST',{platform:'weibo',source_type:'xhs_quality_note',provider:'weibo_web',name:'不匹配'})).status,422);
});

test('参考账号配置只用于优质笔记，严格ID与数量检查，历史ID按配置保留',async()=>{
 const account='abcdefabcdefabcdefabcdef';
 const response=await client.call('/source-connections','POST',{platform:'xiaohongshu',source_type:'xhs_quality_note',provider:'opencli',name:'受控参考账号配置',config:{profile:'controlled',keywords:['旅行','IP'],reference_accounts:[account],max_items:5}});
 assert.equal(response.status,201);assert.deepEqual(response.data.config.reference_accounts,[account]);
 const common={platform:'xiaohongshu',source_type:'xhs_quality_note',provider:'opencli',name:'非法参考账号'};
 for(const accounts of [['https://evil.example/'],[account,account],[account,account.toUpperCase()],['1'.repeat(24),'2'.repeat(24),'3'.repeat(24)]])assert.equal((await client.call('/source-connections','POST',{...common,config:{reference_accounts:accounts}})).status,422);
 assert.equal((await client.call('/source-connections','POST',{...common,source_type:'xhs_topic_signal',config:{reference_accounts:[account]}})).status,422);
 const weibo=await create();assert.equal((await client.call(`/source-connections/${weibo.id}`,'PATCH',{expected_version:1,config:{reference_accounts:[account]}})).status,422);
});
