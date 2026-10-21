import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {server,Client,initialize,adminInput} from './helpers';
import {config} from '../packages/domain/src/config';
import {passwordHash} from '../apps/api/src/auth';
let s:Awaited<ReturnType<typeof server>>,admin:Client,me:any,account:any;
before(async()=>{s=await server();admin=new Client(s.url);});after(async()=>{await s.close();});
test('首次设置无需实例凭据，仍验证Origin和CSRF；并发只创建一个管理员',async()=>{
  await admin.init();const body=adminInput;
  assert.equal((await admin.call('/setup','POST',body,{Origin:'https://evil.test'})).error.code,'ORIGIN_REJECTED');
  assert.equal((await admin.call('/setup','POST',body,{'X-CSRF-Token':'wrong'})).error.code,'CSRF_INVALID');
  const r=await Promise.all([admin.call('/setup','POST',body),admin.call('/setup','POST',body)]);assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);
  assert.equal((await s.db.query('SELECT count(*)::int n FROM users')).rows[0].n,1);
  assert.equal((await admin.call('/setup/status')).data.initialized,true);
});
test('内部登录轮换会话、Argon2id保存，身份响应不泄漏凭据',async()=>{
  const old=admin.cookie;const r=await admin.login(adminInput.email);assert.equal(r.status,200);assert.notEqual(admin.cookie,old);
  assert.match(r.headers.get('set-cookie')!,/HttpOnly/);assert.match(r.headers.get('set-cookie')!,/SameSite=Lax/);
  me=(await admin.call('/me')).data;assert.equal(me.workspace.name,adminInput.workspace_name);
  assert.equal((await s.db.query('SELECT password_hash FROM users')).rows[0].password_hash.startsWith('$argon2id$'),true);
  const serialized=JSON.stringify(me);assert.ok(!serialized.includes('password_hash')&&!serialized.includes('csrf_hash'));
  const oldClient=new Client(s.url);oldClient.cookie=old;assert.equal((await oldClient.call('/me')).status,401);
});
test('并发同键创建复用结果；异载荷409；字段白名单拒绝注入',async()=>{
  const body={platform:'xiaohongshu',platform_user_id:'external-01',name:'测试账号'};const key=randomUUID();
  const r=await Promise.all(Array.from({length:6},()=>admin.call('/accounts','POST',body,{'Idempotency-Key':key})));
  assert.ok(r.every(x=>x.status===201));assert.equal(new Set(r.map(x=>x.data.id)).size,1);account=r[0]!.data;
  assert.equal((await admin.call('/accounts','POST',{...body,name:'改名'},{'Idempotency-Key':key})).error.code,'IDEMPOTENCY_CONFLICT');
  assert.equal((await s.db.query('SELECT count(*)::int n FROM accounts')).rows[0].n,1);
  assert.equal((await admin.call('/accounts/'+account.id,'PATCH',{expected_version:1,platform_user_id:'hijack'})).status,422);
});
test('expected_version竞争只允许一个写入，错误和分页协议统一',async()=>{
  const r=await Promise.all(['名称一','名称二'].map(name=>admin.call('/accounts/'+account.id,'PATCH',{name,expected_version:1})));
  assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);assert.equal(r.find(x=>x.status===409)!.error.code,'VERSION_CONFLICT');
  account=r.find(x=>x.status===200)!.data;
  const invalid=await admin.call('/audit-logs?limit=101');assert.equal(invalid.status,422);assert.match(invalid.error.request_id,/^[\da-f-]{36}$/);assert.equal(invalid.error.retryable,false);
  const first=await admin.call('/audit-logs?limit=1');assert.equal(first.data.items.length,1);assert.ok(first.data.next_cursor);
  const second=await admin.call('/audit-logs?limit=1&cursor='+first.data.next_cursor);assert.notEqual(second.data.items[0].id,first.data.items[0].id);
  assert.equal((await admin.call('/audit-logs?cursor=bad')).status,422);
});
let viewer:Client,operator:Client,editor:Client,editorMember:any;
test('个人邀请均创建管理员，重复邀请被拒绝，管理员共享工作区且幂等结果加密',async()=>{
  for(const name of ['viewer','operator','editor']){
    const email=name+'@example.test';const key=randomUUID();
    const invite=await admin.call('/members','POST',{email,display_name:name},{'Idempotency-Key':key});assert.equal(invite.status,201);assert.deepEqual(invite.data.roles,['admin']);
    if(name==='viewer')assert.equal((await admin.call('/members/'+me.membership.id,'PATCH',{active:false,expected_version:1})).error.code,'LAST_ADMIN');
    const repeat=await admin.call('/members','POST',{email,display_name:name},{'Idempotency-Key':key});assert.equal(repeat.data.invitation_token,invite.data.invitation_token);
    const client=new Client(s.url);await client.init();assert.equal((await client.call('/auth/accept-invite','POST',{invitation_token:invite.data.invitation_token,password:adminInput.password})).status,200);
    assert.equal((await client.call('/auth/accept-invite','POST',{invitation_token:invite.data.invitation_token,password:adminInput.password})).status,422);
    await client.login(email);const session=(await client.call('/me')).data;assert.deepEqual(session.membership.roles,['admin']);assert.equal(session.workspace.id,me.workspace.id);assert.notEqual(session.user.id,me.user.id);assert.ok(session.permissions.includes('admin')&&session.permissions.includes('download.original'));
    if(name==='viewer')viewer=client;if(name==='operator')operator=client;if(name==='editor'){editor=client;editorMember=invite.data;}
  }
  assert.equal((await viewer.call('/members')).status,200);
  const update=await viewer.call('/accounts/'+account.id,'PATCH',{name:'其他管理员可编辑',expected_version:account.version});assert.equal(update.status,200);account=update.data;
  assert.equal((await viewer.call('/files/'+randomUUID()+'/download')).status,404);
  assert.equal((await viewer.call('/jobs/'+randomUUID()+'/cancel','POST',{reason:'管理员取消不存在的任务'})).status,404);
  assert.equal((await admin.call('/members','POST',{email:'denied@example.test',roles:['viewer']})).status,422);
  const stored=JSON.stringify((await s.db.query("SELECT response FROM idempotency_records WHERE route='/members@v1.2'")).rows);
  assert.ok(!stored.includes('invitation_token'));assert.ok(stored.includes('encrypted'));
});
test('诊断202立即可查询Job；同工作区管理员可见，生产Cookie为Secure',async()=>{
  const diagnostic=await admin.call('/diagnostics','POST',{pool:'general',account_id:account.id});assert.equal(diagnostic.status,202);assert.match(diagnostic.data.status_url,/\/jobs\//);
  assert.equal((await admin.call('/jobs/'+diagnostic.data.job_id)).data.state,'queued');assert.equal((await viewer.call('/jobs/'+diagnostic.data.job_id)).status,200);
  const old=config.secure;config.secure=true;try{const client=new Client(s.url);await client.init();assert.match((await client.login('operator@example.test')).headers.get('set-cookie')!,/Secure/);}finally{config.secure=old;}
});
test('工作区、账号与负责人归属不能跨界；数据库复合外键生效',async()=>{
  const w=await s.db.query("INSERT INTO workspaces(name) VALUES('其他工作区') RETURNING id");
  const uid=await s.db.query('INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id',['foreign@example.test','foreign',await passwordHash(adminInput.password)]);
  const member=await s.db.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['admin']) RETURNING id",[w.rows[0].id,uid.rows[0].id]);
  const foreign=await s.db.query("INSERT INTO accounts(workspace_id,platform,platform_user_id,name,owner_id) VALUES($1,'xiaohongshu','external-02','foreign',$2) RETURNING id",[w.rows[0].id,member.rows[0].id]);
  assert.equal((await admin.call('/accounts/'+foreign.rows[0].id)).status,404);
  assert.equal((await admin.call('/me?workspace_id='+w.rows[0].id)).status,404);
  assert.equal((await admin.call('/accounts/'+account.id,'PATCH',{owner_id:member.rows[0].id,expected_version:account.version})).status,422);
  await assert.rejects(s.db.query('INSERT INTO account_memberships VALUES($1,$2,$3)',[w.rows[0].id,account.id,member.rows[0].id]),(e:any)=>e.code==='23503');
  await s.db.query('DELETE FROM account_memberships WHERE account_id=$1 AND membership_id=$2',[account.id,editorMember.id]);
  assert.equal((await editor.call('/accounts/'+account.id)).status,200);
});
test('后端拒绝降级，全员管理员仍支持停用与会话失效，最后管理员不可停用',async()=>{
  assert.equal((await admin.call('/members/'+me.membership.id,'PATCH',{roles:['viewer'],expected_version:1})).status,422);
  assert.equal((await admin.call('/members/'+editorMember.id,'PATCH',{roles:['viewer'],expected_version:1})).status,422);
  assert.deepEqual((await editor.call('/me')).data.membership.roles,['admin']);
  assert.equal((await admin.call('/members/'+editorMember.id,'PATCH',{active:false,expected_version:1})).status,200);
  assert.equal((await editor.call('/me')).status,401);
  const last=new Client(s.url);await last.login('foreign@example.test');const lastMe=(await last.call('/me')).data;
  assert.equal((await last.call('/members/'+lastMe.membership.id,'PATCH',{active:false,expected_version:1})).error.code,'LAST_ADMIN');
});
test('通知按人隔离；已读只修改通知；审计追加且不记录密码',async()=>{
  const other=(await operator.call('/me')).data;
  const row=await s.db.query("INSERT INTO notifications(workspace_id,recipient_id,event_key,title) VALUES($1,$2,'test:event','测试通知') RETURNING *",[me.workspace.id,me.membership.id]);
  const otherNotification=await s.db.query("INSERT INTO notifications(workspace_id,recipient_id,event_key,title) VALUES($1,$2,'test:event','测试通知') RETURNING *",[me.workspace.id,other.membership.id]);
  assert.equal((await operator.call('/notifications/'+row.rows[0].id+'/read','POST')).status,404);
  assert.equal((await admin.call('/notifications/'+row.rows[0].id+'/read','POST')).status,200);
  assert.equal((await s.db.query('SELECT read_at FROM notifications WHERE id=$1',[otherNotification.rows[0].id])).rows[0].read_at,null);
  assert.equal((await admin.call('/notifications?unread=true')).data.items.length,0);
  await assert.rejects(s.db.query('UPDATE audit_logs SET action=$1',['tamper']),/append-only/);
  await assert.rejects(s.db.query('DELETE FROM audit_logs'),/append-only/);
  const logs=JSON.stringify((await admin.call('/audit-logs?limit=100')).data);assert.ok(!logs.includes(adminInput.password)&&!logs.includes('password_hash')&&!logs.includes('invitation_token'));
});
test('绝对/闲置过期、注销和登录限流',async()=>{
  const idle=new Client(s.url);await idle.login('operator@example.test');
  await s.db.query("UPDATE sessions SET last_seen_at=now()-interval '3 hours' WHERE user_id=$1",[(await operator.call('/me')).data.user.id]);
  assert.equal((await idle.call('/me')).status,401);
  await operator.login('operator@example.test');const uid=(await operator.call('/me')).data.user.id;
  await s.db.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",[uid]);assert.equal((await operator.call('/me')).status,401);
  const logout=await viewer.call('/auth/logout','POST');assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie')!,/Expires=Thu, 01 Jan 1970/);assert.equal((await viewer.call('/me')).status,401);
  const bad=new Client(s.url);await bad.init();let last:any;
  for(let i=0;i<11;i++)last=await bad.call('/auth/login','POST',{email:'nobody@example.test',password:'wrong'});
  assert.equal(last.status,429);
});
