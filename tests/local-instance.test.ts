import {test} from 'node:test';
import assert from 'node:assert/strict';
import {server,Client,initialize,legacyMember,reset} from './helpers';
import {Jobs} from '../packages/domain/src/jobs';
import {randomUUID} from 'node:crypto';
import {ensureInstance} from '../packages/domain/src/instance';

test('无Cookie打开本地实例即有默认工作区，重开浏览器不会创建新用户或空间',async()=>{
  const env=await server();
  try{
    const first=await new Client(env.url).call('/instance');
    assert.equal(first.status,200);assert.equal(first.data.mode,'local');
    assert.equal(first.data.workspace.name,'我的工作台');
    const second=await new Client(env.url).call('/instance');
    assert.equal(second.data.workspace.id,first.data.workspace.id);
    assert.ok(!JSON.stringify(first.data).match(/password|email|roles|expires_at/));
  }finally{await env.close();}
});

test('并发冷启动仅创建一个默认身份，重启不改变ID且不生成可用密码',async()=>{
  const env=await server();try{
    await reset(env.db);await Promise.all(Array.from({length:5},()=>ensureInstance(env.db)));
    const rows=await env.db.query('SELECT m.id,m.user_id,m.workspace_id,u.password_hash FROM memberships m JOIN users u ON u.id=m.user_id');
    assert.equal(rows.rowCount,1);assert.equal(rows.rows[0].password_hash,null);
    await ensureInstance(env.db);assert.deepEqual((await env.db.query('SELECT m.id,m.user_id,m.workspace_id,u.password_hash FROM memberships m JOIN users u ON u.id=m.user_id')).rows,rows.rows);
  }finally{await env.close();}
});

test('歧义旧库拒绝猜测，显式选择后持久复用且不处理未选空间的任务',async()=>{
  const env=await server(),beforeW=process.env.YOYO_DEFAULT_WORKSPACE_ID,beforeM=process.env.YOYO_DEFAULT_MEMBER_ID;
  try{
    const me=await initialize(new Client(env.url));await legacyMember(env.db,'extra-local@example.test');
    await env.db.query('UPDATE instance_state SET default_workspace_id=NULL,default_member_id=NULL WHERE id=1');
    await assert.rejects(ensureInstance(env.db),{code:'INSTANCE_SELECTION_REQUIRED'});
    const other=(await env.db.query("INSERT INTO workspaces(name) VALUES('未选空间') RETURNING id")).rows[0].id;
    const foreignMember=(await env.db.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['admin']) RETURNING id",[other,me.user.id])).rows[0].id;
    const foreignJob=(await env.db.query("INSERT INTO jobs(workspace_id,created_by,type,pool,request_id) VALUES($1,$2,'system.check','general',$3) RETURNING id",[other,foreignMember,randomUUID()])).rows[0].id;
    const event=(await env.db.query("INSERT INTO outbox(workspace_id,event_key,event_type,payload) VALUES($1,'old-unselected','system.check',$2) RETURNING id",[other,JSON.stringify({created_by:foreignMember,request_id:randomUUID()})])).rows[0].id;
    process.env.YOYO_DEFAULT_MEMBER_ID=me.membership.id;
    await assert.rejects(ensureInstance(env.db),{code:'INSTANCE_SELECTION_REQUIRED'});
    process.env.YOYO_DEFAULT_WORKSPACE_ID=me.workspace.id;await ensureInstance(env.db);
    assert.equal((await new Client(env.url).call('/instance')).data.workspace.id,me.workspace.id);
    assert.deepEqual((await env.db.query('SELECT state,error_code,created_by FROM jobs WHERE id=$1',[foreignJob])).rows[0],{state:'failed',error_code:'INSTANCE_SCOPE_UNSELECTED',created_by:foreignMember});
    assert.ok((await env.db.query('SELECT retired_at FROM outbox WHERE id=$1',[event])).rows[0].retired_at);
    process.env.YOYO_DEFAULT_WORKSPACE_ID=other;await assert.rejects(ensureInstance(env.db),{code:'INSTANCE_SELECTION_CONFLICT'});
  }finally{
    if(beforeW===undefined)delete process.env.YOYO_DEFAULT_WORKSPACE_ID;else process.env.YOYO_DEFAULT_WORKSPACE_ID=beforeW;
    if(beforeM===undefined)delete process.env.YOYO_DEFAULT_MEMBER_ID;else process.env.YOYO_DEFAULT_MEMBER_ID=beforeM;
    await env.close();
  }
});

test('请求令牌到期仍可读取实例并自动重新取得凭据，不要求登录',async()=>{
  const env=await server(),now=Date.now;
  try{
    const c=new Client(env.url);await c.init();Date.now=()=>now()+3601_000;
    assert.equal((await c.call('/accounts','POST',{})).error.code,'CSRF_INVALID');
    assert.equal((await c.call('/instance')).status,200);await c.init();
    assert.equal((await c.call('/accounts','POST',{})).status,422);
  }finally{Date.now=now;await env.close();}
});

test('旧任务发起者失效时不会调用处理器或外部能力，也不偷偷改写发起者',async()=>{
  const env=await server();
  try{
    const me=await initialize(new Client(env.url)),old=await legacyMember(env.db,'inactive-job@example.test',['admin'],false);
    const row=(await env.db.query("INSERT INTO jobs(workspace_id,created_by,type,pool,request_id) VALUES($1,$2,'system.check','general',$3) RETURNING id",[me.workspace.id,old.id,randomUUID()])).rows[0];
    let calls=0;const jobs=new Jobs(env.db,{'system.check':async()=>{calls++;return {result:{}};}});
    const j=(await jobs.claim('general'))!;assert.equal(j.id,row.id);await jobs.process(j);
    assert.equal(calls,0);const stored=(await env.db.query('SELECT state,error_code,created_by FROM jobs WHERE id=$1',[j.id])).rows[0];
    assert.equal(stored.state,'failed');assert.equal(stored.error_code,'JOB_SCOPE_CHANGED');assert.equal(stored.created_by,old.id);
  }finally{await env.close();}
});

test('无需登录取得请求令牌后可写业务，另一个浏览器读取同一实例内容',async()=>{
  const env=await server();
  try{
    const c=new Client(env.url);
    assert.equal((await c.call('/accounts','POST',{})).status,403);
    assert.equal((await c.call('/request/csrf')).status,200);
    const made=await c.call('/accounts','POST',{platform:'weibo',platform_user_id:'local-test',name:'本机合成账号'});
    assert.equal(made.status,201);
    const other=new Client(env.url);other.cookie='yoyo_session=obsolete-login';
    assert.equal((await other.call('/accounts')).data.items[0].id,made.data.id);
  }finally{await env.close();}
});
