import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {server,Client,initialize,reset} from './helpers';
import {ensureInstance} from '../packages/domain/src/instance';
let env:Awaited<ReturnType<typeof server>>,c:Client;
before(async()=>{env=await server();});after(async()=>env.close());beforeEach(async()=>{await reset(env.db);await ensureInstance(env.db);c=new Client(env.url);await initialize(c);});
async function make(){const body={platform:'xiaohongshu',platform_user_id:randomUUID().replaceAll('-','').slice(0,24),name:'明确合成删除账号'},key=randomUUID(),r=await c.call('/accounts','POST',body,{'Idempotency-Key':key});assert.equal(r.status,201);return {a:r.data,body,key};}
const confirmation=(a:any)=>({expected_version:a.version,confirmed:true});
async function remove(a:any,key=randomUUID()){return c.call('/accounts/'+a.id,'DELETE',confirmation(a),{'Idempotency-Key':key});}
async function waitForLock(fragment:string){const deadline=Date.now()+3000;while(Date.now()<deadline){const r=await env.db.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND position($1 in query)>0 LIMIT 1",[fragment]);if(r.rowCount)return;await new Promise(r=>setTimeout(r,10));}throw new Error('Expected database lock was not observed');}
test('空账号删除清理权限关联并保留审计；重复删除幂等，旧创建重放不复活记录',async()=>{
 const {a,body,key}=await make(),deletionKey=randomUUID();const original=(await c.call('/instance')).data.workspace.id;
 const results=await Promise.all(Array.from({length:4},()=>remove(a,deletionKey)));assert.ok(results.every(r=>r.status===200));assert.deepEqual(results[0]!.data,{account_id:a.id,deleted:true});
 assert.equal((await c.call('/accounts/'+a.id)).status,404);assert.equal((await c.call('/accounts')).data.items.length,0);assert.equal((await c.call('/instance')).data.workspace.id,original);
 assert.equal((await env.db.query('SELECT count(*)::int n FROM account_memberships WHERE account_id=$1',[a.id])).rows[0].n,0);
 assert.equal((await env.db.query("SELECT count(*)::int n FROM audit_logs WHERE action='account.delete' AND object_id=$1",[a.id])).rows[0].n,1);
 assert.equal((await c.call('/accounts','POST',body,{'Idempotency-Key':key})).status,404);assert.equal((await remove(a)).status,404);
 const next=await c.call('/accounts','POST',body);assert.equal(next.status,201);assert.notEqual(next.data.id,a.id);assert.equal((await remove(a,deletionKey)).status,200);assert.equal((await c.call('/accounts/'+next.data.id)).status,200);
});
test('删除无需名称，仍需版本/明确确认及管理员权限；不正确的请求不改变账号',async()=>{
 const {a}=await make(),path='/accounts/'+a.id;
 for(const body of [{...confirmation(a),confirmed:false},{expected_version:a.version},{}])assert.equal((await c.call(path,'DELETE',body)).status,422);
 assert.equal((await c.call(path,'DELETE',{...confirmation(a),expected_version:a.version+1})).status,409);
 assert.equal((await c.call(path,'DELETE',confirmation(a),{'X-CSRF-Token':'wrong'})).status,403);
 await env.db.query("UPDATE memberships SET roles=ARRAY['viewer']");assert.equal((await remove(a)).status,403);await env.db.query("UPDATE memberships SET roles=ARRAY['admin']");assert.equal((await c.call(path)).status,200);
});
test('有笔记或在途任务/事件的账号不能删除，取消后的任务历史也保留',async()=>{
 const {a}=await make();const pub=await c.call('/publications','POST',{account_id:a.id,platform_note_id:'deletion-fixture-note',url:'https://www.xiaohongshu.com/explore/deletion-fixture-note',title:'明确合成历史笔记',media_type:'graphic',published_at:'2026-09-01T00:00:00.000Z',traffic_type:'unknown'});assert.equal(pub.status,201);
 const blocked=await remove(a);assert.equal(blocked.error.code,'ACCOUNT_HAS_HISTORY');assert.ok(blocked.error.field_errors.blocking_categories.includes('已登记笔记'));
 assert.equal((await c.call('/publications/'+pub.data.id)).status,200);
 const {a:b}=await make(),job=(await c.call('/diagnostics','POST',{pool:'general',account_id:b.id})).data;assert.equal((await remove(b)).error.code,'ACCOUNT_HAS_ACTIVE_TASKS');
 await c.call('/jobs/'+job.job_id+'/cancel','POST',{reason:'明确合成取消'});await env.db.query('UPDATE outbox SET dispatched_at=now() WHERE id=$1',[job.event_id]);assert.equal((await remove(b)).error.code,'ACCOUNT_HAS_HISTORY');
 assert.equal((await c.call('/accounts/'+b.id)).status,200);
});
test('失败或取消的账号验证仍属于不可删除历史，成员关系不会被部分清理',async()=>{
 const {a}=await make();const bound=(await c.call('/accounts/'+a.id,'PATCH',{browser_profile_ref:'controlled-profile',expected_version:a.version})).data;
 const v=(await c.call(`/accounts/${a.id}/verifications`,'POST',{expected_version:bound.version,binding_version:bound.identity_binding_version})).data.verification;
 await c.call('/jobs/'+v.job_id+'/cancel','POST',{reason:'明确合成取消'});await env.db.query('UPDATE outbox SET dispatched_at=now() WHERE account_id=$1',[a.id]);
 const r=await remove(bound);assert.equal(r.error.code,'ACCOUNT_HAS_HISTORY');assert.ok(r.error.field_errors.blocking_categories.includes('账号验证记录'));
 assert.equal((await env.db.query('SELECT count(*)::int n FROM account_memberships WHERE account_id=$1',[a.id])).rows[0].n,1);assert.equal((await c.call(`/accounts/${a.id}/verifications/${v.id}`)).status,200);
});
test('无效旧ID可删除；跨空间账号不可删除且不泄漏其关联情况',async()=>{
 const {a}=await make();await env.db.query("UPDATE accounts SET platform_user_id='legacy-invalid-id' WHERE id=$1",[a.id]);assert.equal((await remove(a)).status,200);
 const w=(await env.db.query("INSERT INTO workspaces(name) VALUES('删除测试其他空间') RETURNING id")).rows[0].id,u=(await env.db.query("INSERT INTO users(email,display_name) VALUES('delete-foreign@example.test','合成历史成员') RETURNING id")).rows[0].id;
 const m=(await env.db.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['admin']) RETURNING id",[w,u])).rows[0].id;
 const foreign=(await env.db.query("INSERT INTO accounts(workspace_id,platform,platform_user_id,name,owner_id) VALUES($1,'xiaohongshu','legacy','其他空间账号',$2) RETURNING *",[w,m])).rows[0];assert.equal((await remove(foreign)).status,404);assert.equal((await env.db.query('SELECT count(*)::int n FROM accounts WHERE id=$1',[foreign.id])).rows[0].n,1);
});
test('检查发现新增的外键表，连带删除外键也不能绕过历史保护',async()=>{
 const {a}=await make();await env.db.query('CREATE TABLE account_delete_guard_probe(account_id uuid REFERENCES accounts(id) ON DELETE CASCADE)');
 try{await env.db.query('INSERT INTO account_delete_guard_probe VALUES($1)',[a.id]);const r=await remove(a);assert.equal(r.error.code,'ACCOUNT_HAS_HISTORY');assert.equal((await env.db.query('SELECT count(*)::int n FROM account_delete_guard_probe')).rows[0].n,1);}finally{await env.db.query('DROP TABLE account_delete_guard_probe');}
});
test('关联写入与删除并发：等待已开始的外键写入，提交后拒绝删除',async()=>{
 const {a}=await make();await env.db.query('CREATE TABLE account_delete_guard_probe(account_id uuid REFERENCES accounts(id) ON DELETE CASCADE)');const writer=await env.db.pool.connect();let deleting:ReturnType<typeof remove>|undefined;
 try{await writer.query('BEGIN');await writer.query('INSERT INTO account_delete_guard_probe VALUES($1)',[a.id]);deleting=remove(a);await waitForLock('FOR UPDATE OF ac');await writer.query('COMMIT');const r=await deleting;assert.equal(r.error.code,'ACCOUNT_HAS_HISTORY');assert.equal((await c.call('/accounts/'+a.id)).status,200);}finally{await writer.query('ROLLBACK');writer.release();if(deleting)await deleting;await env.db.query('DROP TABLE account_delete_guard_probe');}
});
test('删除先持有父锁时，新关联写入不能在检查和删除之间插入',async()=>{
 const {a}=await make();await env.db.query('CREATE TABLE account_delete_guard_probe(account_id uuid REFERENCES accounts(id) ON DELETE CASCADE)');const blocker=await env.db.pool.connect();let deleting:ReturnType<typeof remove>|undefined,writing:Promise<any>|undefined;
 try{await blocker.query('BEGIN');await blocker.query('SELECT * FROM account_memberships WHERE account_id=$1 FOR UPDATE',[a.id]);deleting=remove(a);await waitForLock('DELETE FROM account_memberships');writing=env.db.query('INSERT INTO account_delete_guard_probe VALUES($1)',[a.id]).then(()=>({inserted:true}),(e:any)=>({error:e.code}));await waitForLock('INSERT INTO account_delete_guard_probe');await blocker.query('COMMIT');assert.equal((await deleting).status,200);assert.equal((await writing).error,'23503');assert.equal((await env.db.query('SELECT count(*)::int n FROM account_delete_guard_probe')).rows[0].n,0);}finally{await blocker.query('ROLLBACK');blocker.release();if(deleting)await deleting;if(writing)await writing;await env.db.query('DROP TABLE account_delete_guard_probe');}
});
