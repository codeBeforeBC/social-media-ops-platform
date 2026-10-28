import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {server,Client,initialize} from './helpers';
import {xhsAccountIdentity} from '../packages/domain/src/xhs-account';
let env:Awaited<ReturnType<typeof server>>,c:Client;
const id='abcdefabcdefabcdefabcdef',url=`https://www.xiaohongshu.com/user/profile/${id}`;
before(async()=>{env=await server();c=new Client(env.url);await initialize(c);});after(async()=>env.close());
test('小红书身份只解析明确的内部ID/主页，去除访问参数且不接受笔记/短链/任意地址',()=>{
  assert.deepEqual(xhsAccountIdentity(' '+id.toUpperCase()+' '),{id,profile_url:url});
  assert.deepEqual(xhsAccountIdentity(url+'?xsec_token=synthetic-only#fragment'),{id,profile_url:url});
  for(const value of ['昵称','123456789','https://xhslink.com/abc',url.replace('/user/profile/','/explore/'),url.replace('https:','http:'),url.replace('www.xiaohongshu.com','www.xiaohongshu.com.evil.test'),url.replace('www.','user@www.'),url.replace('.com/','.com:443/'),url.replace('/user/','/a/../user/'),url.replace('/user/','/%75ser/'),'https://127.0.0.1/'+id,url+'\nsecret',null,'x'.repeat(2001)])assert.equal(xhsAccountIdentity(value),null,String(value));
});
test('保存只登记小红书、规范化ID和主页，幂等重放不重复，不存签名参数',async()=>{
  const body={platform:'xiaohongshu',platform_user_id:url+'?xsec_token=synthetic-only',name:'明确合成账号'},key=randomUUID();
  const [one,two]=await Promise.all([c.call('/accounts','POST',body,{'Idempotency-Key':key}),c.call('/accounts','POST',body,{'Idempotency-Key':key})]);
  assert.equal(one.status,201);assert.equal(two.data.id,one.data.id);assert.equal(one.data.platform_user_id,id);assert.equal(one.data.profile_url,url);assert.ok(!JSON.stringify(one.data).includes('xsec_token'));
  assert.equal((await env.db.query('SELECT count(*)::int n FROM accounts')).rows[0].n,1);
  assert.equal((await env.db.query('SELECT count(*)::int n FROM jobs')).rows[0].n,0);
  assert.equal((await env.db.query('SELECT count(*)::int n FROM outbox')).rows[0].n,0);
});
test('相同身份并发新增返回已有账号入口，保留原备注与工作区边界',async()=>{
  const existing=(await c.call('/accounts')).data.items[0];
  const results=await Promise.all([c.call('/accounts','POST',{platform:'xiaohongshu',platform_user_id:id,name:'不会覆盖原备注'}),c.call('/accounts','POST',{platform:'xiaohongshu',platform_user_id:url,name:'另一次重复'})]);
  for(const r of results){assert.equal(r.status,409);assert.equal(r.error.code,'ACCOUNT_EXISTS');assert.equal(r.error.field_errors.account_id,existing.id);}
  assert.equal((await c.call('/accounts/'+existing.id)).data.name,existing.name);
});
test('无效身份/其他平台/伪造已验证状态均拒绝，无远端任务或入库副作用',async()=>{
  const size=(await c.call('/accounts')).data.items.length;
  for(const body of [{platform:'weibo',platform_user_id:id,name:'不支持平台'},{platform:'xiaohongshu',platform_user_id:'1234',name:'展示号'},{platform:'xiaohongshu',platform_user_id:id,name:'伪造状态',verified:true}])assert.equal((await c.call('/accounts','POST',body)).status,422);
  assert.equal((await c.call('/accounts')).data.items.length,size);
});
test('旧账号格式不符仍可读取和编辑备注，不能普通编辑换号或改平台',async()=>{
  const me=(await c.call('/instance')).data;
  const member=(await env.db.query('SELECT default_member_id id FROM instance_state WHERE id=1')).rows[0].id;
  const legacy=(await env.db.query("INSERT INTO accounts(workspace_id,platform,platform_user_id,name,owner_id) VALUES($1,'xiaohongshu','old-display-number','历史合成账号',$2) RETURNING *",[me.workspace.id,member])).rows[0];
  const r=await c.call('/accounts/'+legacy.id,'PATCH',{name:'仅修正备注',expected_version:legacy.version});assert.equal(r.status,200);assert.equal(r.data.platform_user_id,'old-display-number');
  assert.equal((await c.call('/accounts/'+legacy.id,'PATCH',{platform_user_id:id,expected_version:r.data.version})).status,422);
});
