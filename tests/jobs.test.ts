import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {database,reset} from './helpers';
import {Jobs} from '../packages/domain/src/jobs';
import {Commands} from '../apps/api/src/commands';
import {Actor} from '../packages/domain/src/protocol';
let db:Awaited<ReturnType<typeof database>>,jobs:Jobs,actor:Actor;
before(async()=>{db=await database();await reset(db);jobs=new Jobs(db);const w=await db.query("INSERT INTO workspaces(name) VALUES('任务测试') RETURNING id");const u=await db.query("INSERT INTO users(email,display_name,password_hash) VALUES('jobs@example.test','任务测试','not-loginable') RETURNING id");const m=await db.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['admin']) RETURNING id",[w.rows[0].id,u.rows[0].id]);actor={workspaceId:w.rows[0].id,userId:u.rows[0].id,memberId:m.rows[0].id,roles:['admin'],sessionHash:'',requestId:randomUUID()};});
after(()=>db.close());
async function enqueue(type='system.check',pool='general',inputVersion:number|null=null){const r=await db.query('INSERT INTO jobs(workspace_id,created_by,type,pool,input_version,request_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[actor.workspaceId,actor.memberId,type,pool,inputVersion,randomUUID()]);return r.rows[0];}
test('业务事件回滚不产生任务，Outbox并发分发只创建一个Job',async()=>{
  await assert.rejects(db.transaction(async tx=>{await tx.query("INSERT INTO outbox(workspace_id,event_key,event_type,payload) VALUES($1,'rollback','system.check',$2)",[actor.workspaceId,JSON.stringify({created_by:actor.memberId,request_id:actor.requestId})]);throw new Error('rollback');}));
  assert.equal((await db.query("SELECT count(*)::int n FROM outbox WHERE event_key='rollback'")).rows[0].n,0);
  await db.query("INSERT INTO outbox(workspace_id,event_key,event_type,payload) VALUES($1,'event-one','system.check',$2)",[actor.workspaceId,JSON.stringify({created_by:actor.memberId,request_id:actor.requestId})]);
  await Promise.all([jobs.dispatch(),jobs.dispatch()]);assert.equal((await db.query('SELECT count(*)::int n FROM jobs')).rows[0].n,1);
  const j=await jobs.claim('general');assert.ok(j);await jobs.process(j!);assert.equal((await db.query('SELECT state FROM jobs WHERE id=$1',[j!.id])).rows[0].state,'succeeded');
});
test('租约保证单领取；心跳延长租约；已完成不会重复通知',async()=>{
  await enqueue();const r=await Promise.all([jobs.claim('general'),jobs.claim('general')]);assert.equal(r.filter(Boolean).length,1);const j=r.find(Boolean)!;
  assert.equal(await jobs.heartbeat(j),true);await jobs.process(j);assert.equal(await jobs.complete(j,{}),false);
  assert.equal((await db.query('SELECT count(*)::int n FROM notifications WHERE job_id=$1',[j.id])).rows[0].n,1);
});
test('真实领取进程被SIGKILL后，重启领取恢复；旧租约结果被拒绝',async()=>{
  const seed=await enqueue();const child=fork('tests/fixtures/lease-crash.mjs',[],{stdio:['ignore','ignore','inherit','ipc'],env:{...process.env}});
  const claimed=await new Promise<any>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Child claim timed out')),15000);child.once('error',reject);child.once('message',m=>{clearTimeout(timeout);resolve(m);});});assert.equal(claimed.id,seed.id);
  const exit=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exit;
  await new Promise(r=>setTimeout(r,2300));const recovered=await jobs.claim('general');assert.equal(recovered!.id,seed.id);assert.equal(recovered!.attempts,2);
  assert.equal(await jobs.complete({...seed,lease_token:claimed.lease_token},{}),false);await jobs.process(recovered!);
  assert.equal((await db.query('SELECT state FROM jobs WHERE id=$1',[seed.id])).rows[0].state,'succeeded');
});
test('取消与过期版本阻止结果及副作用提交',async()=>{
  const c=new Commands(db);await enqueue();const j=(await jobs.claim('general'))!;
  await db.transaction(tx=>c.cancelJob(tx,actor,j.id,{reason:'测试取消'}));let effects=0;
  assert.equal(await jobs.complete(j,{},async()=>{effects++;}),false);assert.equal(effects,0);
  await enqueue('system.check','general',1);const stale=(await jobs.claim('general'))!;await db.query('UPDATE workspaces SET version=version+1 WHERE id=$1',[actor.workspaceId]);
  assert.equal(await jobs.complete(stale,{},async()=>{effects++;}),false);assert.equal(effects,0);assert.equal((await db.query('SELECT error_code FROM jobs WHERE id=$1',[stale.id])).rows[0].error_code,'STALE_INPUT');
});
test('失败退避重试有上限，管理员可重试；提醒池不受一般池积压影响',async()=>{
  const seed=await enqueue('unsupported');
  for(let i=0;i<3;i++){const j=(await jobs.claim('general'))!;assert.equal(j.id,seed.id);await jobs.process(j);if(i<2){const r=(await db.query('SELECT state,available_at FROM jobs WHERE id=$1',[j.id])).rows[0];assert.equal(r.state,'queued');assert.ok(new Date(r.available_at).getTime()>Date.now());await db.query('UPDATE jobs SET available_at=now() WHERE id=$1',[j.id]);}}
  assert.equal((await db.query('SELECT state,error_code FROM jobs WHERE id=$1',[seed.id])).rows[0].state,'failed');
  const c=new Commands(db);await db.transaction(tx=>c.retryJob(tx,actor,seed.id,{reason:'受控重试'}));const retried=(await jobs.claim('general'))!;assert.equal(retried.attempts,1);await db.transaction(tx=>c.cancelJob(tx,actor,retried.id,{reason:'结束用例'}));
  await enqueue();const blocked=(await jobs.claim('general'))!;await enqueue('system.check','reminder');const reminder=(await jobs.claim('reminder'))!;assert.equal(reminder.pool,'reminder');await jobs.process(reminder);
  assert.equal((await db.query('SELECT state FROM jobs WHERE id=$1',[reminder.id])).rows[0].state,'succeeded');assert.equal((await db.query('SELECT state FROM jobs WHERE id=$1',[blocked.id])).rows[0].state,'running');await jobs.process(blocked);
});
test('超过最大尝试的失联任务进入失败；未来调度事件暂不分发',async()=>{
  const seed=await enqueue();await db.query("UPDATE jobs SET state='running',attempts=max_attempts,lease_until=now()-interval '1 second' WHERE id=$1",[seed.id]);assert.equal(await jobs.claim('general'),null);assert.equal((await db.query('SELECT error_code FROM jobs WHERE id=$1',[seed.id])).rows[0].error_code,'ATTEMPTS_EXHAUSTED');
  await db.query("INSERT INTO outbox(workspace_id,event_key,event_type,payload,available_at) VALUES($1,'future','system.check',$2,now()+interval '1 day')",[actor.workspaceId,JSON.stringify({created_by:actor.memberId,request_id:actor.requestId})]);assert.equal(await jobs.dispatch(),0);
});
test('长任务心跳跨越初始租约，超时拒绝迟到结果和副作用',async()=>{
  let effects=0;
  const slow=new Jobs(db,{'test.slow':async()=>{await new Promise(r=>setTimeout(r,2300));return {result:{ok:true},effects:async()=>{effects++;}};}});
  await enqueue('test.slow');const long=(await slow.claim('general'))!;await slow.process(long);
  assert.equal((await db.query('SELECT state FROM jobs WHERE id=$1',[long.id])).rows[0].state,'succeeded');assert.equal(effects,1);
  const timeout=await enqueue('test.slow');await db.query('UPDATE jobs SET timeout_seconds=1,max_attempts=1 WHERE id=$1',[timeout.id]);
  const short=(await slow.claim('general'))!;await slow.process(short);await new Promise(r=>setTimeout(r,1500));
  const r=(await db.query('SELECT state,error_code,result FROM jobs WHERE id=$1',[short.id])).rows[0];assert.equal(r.state,'failed');assert.equal(r.error_code,'JOB_TIMEOUT');assert.equal(r.result,null);assert.equal(effects,1);
});
