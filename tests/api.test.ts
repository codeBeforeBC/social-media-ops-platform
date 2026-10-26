import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {request} from 'node:http';
import {server,Client,initialize,legacyMember} from './helpers';
import {config} from '../packages/domain/src/config';
let s:Awaited<ReturnType<typeof server>>,c:Client,me:any,account:any;
before(async()=>{s=await server();c=new Client(s.url);me=await initialize(c);});after(async()=>s.close());
test('不同浏览器直接使用同一个默认工作区，不公开登录或用户信息',async()=>{
 const other=new Client(s.url);other.cookie='yoyo_session=old-user';const a=await c.call('/instance'),b=await other.call('/instance');assert.equal(a.status,200);assert.deepEqual(a.data,b.data);assert.equal(a.data.mode,'local');assert.ok(!JSON.stringify(a.data).match(/email|password|roles|expires_at/));
});
test('登录、设置、成员和旧身份入口统一退出，不因旧Cookie或缓存恢复',async()=>{
 const before=(await s.db.query('SELECT count(*)::int n FROM users')).rows[0].n;
 for(const [path,method] of [['/setup/status','GET'],['/setup','POST'],['/auth/csrf','GET'],['/auth/login','POST'],['/auth/logout','POST'],['/auth/accept-invite','POST'],['/auth/session','GET'],['/me','GET'],['/members','GET'],['/members','POST'],['/members/'+randomUUID(),'PATCH']])assert.equal((await c.call(path!,method!,{})).status,410,path);
 assert.equal((await s.db.query('SELECT count(*)::int n FROM users')).rows[0].n,before);
});
test('本机Host、精确Origin、技术令牌与格式仍保护写请求，Cookie不再代表身份',async()=>{
 const rejected=await new Promise<number|undefined>((resolve,reject)=>{const req=request(s.url+'/api/v1/instance',{headers:{Host:'evil.test'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});assert.equal(rejected,403);
 assert.equal((await c.call('/accounts','POST',{}, {Origin:'https://evil.test'})).error.code,'ORIGIN_REJECTED');
 assert.equal((await c.call('/accounts','POST',{}, {'X-CSRF-Token':'wrong'})).error.code,'CSRF_INVALID');
 assert.equal((await c.call('/accounts','POST',{}, {'Content-Type':'text/plain'})).status,415);
 const other=new Client(s.url);assert.equal((await other.call('/accounts','POST',{})).status,403);await other.init();assert.equal((await other.call('/accounts','POST',{})).status,422);
 const cookie=c.cookie,token=c.csrf;await c.init();assert.equal(c.cookie,cookie);assert.equal(c.csrf,token);
 const old=config.secure;config.secure=true;try{const fresh=new Client(s.url);const csrf=await fresh.init();assert.match(csrf.headers.get('set-cookie')!,/HttpOnly/);assert.match(csrf.headers.get('set-cookie')!,/SameSite=Strict/);assert.match(csrf.headers.get('set-cookie')!,/Secure/);}finally{config.secure=old;}
});
test('并发同键创建复用结果，异载荷409，身份与负责人不能由客户端注入',async()=>{
 const body={platform:'xiaohongshu',platform_user_id:'external-01',name:'合成账号'},key=randomUUID();
 const r=await Promise.all(Array.from({length:6},()=>c.call('/accounts','POST',body,{'Idempotency-Key':key})));assert.ok(r.every(x=>x.status===201));assert.equal(new Set(r.map(x=>x.data.id)).size,1);account=r[0]!.data;assert.equal(account.owner_id,me.membership.id);
 assert.equal((await c.call('/accounts','POST',{...body,name:'changed'},{'Idempotency-Key':key})).error.code,'IDEMPOTENCY_CONFLICT');
 assert.equal((await c.call('/accounts','POST',{...body,owner_id:randomUUID()})).status,422);
 assert.equal((await c.call('/accounts/'+account.id,'PATCH',{owner_id:randomUUID(),expected_version:1})).status,422);
});
test('expected_version仍避免多标签页覆盖，错误分页和审计追加协议保留',async()=>{
 const r=await Promise.all(['名称一','名称二'].map(name=>c.call('/accounts/'+account.id,'PATCH',{name,expected_version:1})));assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);account=r.find(x=>x.status===200)!.data;
 assert.equal((await c.call('/audit-logs?limit=101')).status,422);const first=await c.call('/audit-logs?limit=1');assert.ok(first.data.next_cursor);assert.notEqual((await c.call('/audit-logs?limit=1&cursor='+first.data.next_cursor)).data.items[0].id,first.data.items[0].id);
 await assert.rejects(s.db.query("UPDATE audit_logs SET action='tamper'"),/append-only/);
});
test('服务端默认映射不能由workspace_id或旧Cookie切换，复合外键继续阻止跨空间',async()=>{
 const w=(await s.db.query("INSERT INTO workspaces(name) VALUES('其他空间') RETURNING id")).rows[0].id;
 const u=(await s.db.query("INSERT INTO users(email,display_name) VALUES('foreign@example.test','历史身份') RETURNING id")).rows[0].id;
 const m=(await s.db.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['admin']) RETURNING id",[w,u])).rows[0].id;
 const foreign=(await s.db.query("INSERT INTO accounts(workspace_id,platform,platform_user_id,name,owner_id) VALUES($1,'weibo','foreign','其他账号',$2) RETURNING id",[w,m])).rows[0].id;
 assert.equal((await c.call('/accounts/'+foreign)).status,404);assert.equal((await c.call('/accounts?workspace_id='+w)).status,404);
 await assert.rejects(s.db.query('INSERT INTO account_memberships VALUES($1,$2,$3)',[w,account.id,m]),(e:any)=>e.code==='23503');
});
test('通知中心保留历史收件人并按事件合并已读，不与其他工作区混合',async()=>{
 const member=await legacyMember(s.db,'history@example.test');const ids=[];
 for(const recipient of [me.membership.id,member.id])ids.push((await s.db.query("INSERT INTO notifications(workspace_id,recipient_id,event_key,title) VALUES($1,$2,'shared:event','合成通知') RETURNING id",[me.workspace.id,recipient])).rows[0].id);
 assert.equal((await c.call('/notifications')).data.items.filter((n:any)=>n.event_key==='shared:event').length,1);
 assert.equal((await c.call('/notifications/'+ids[1]+'/read','POST')).status,200);assert.equal((await s.db.query("SELECT count(*)::int n FROM notifications WHERE event_key='shared:event' AND read_at IS NOT NULL")).rows[0].n,2);
 assert.equal((await c.call('/notifications?unread=true')).data.items.length,0);
});
test('新任务使用稳定默认身份，浏览器请求令牌不影响任务持久化',async()=>{
 const d=await c.call('/diagnostics','POST',{pool:'general',account_id:account.id});assert.equal(d.status,202);const j=await c.call('/jobs/'+d.data.job_id);assert.equal(j.data.state,'queued');assert.equal((await s.db.query('SELECT created_by FROM jobs WHERE id=$1',[d.data.job_id])).rows[0].created_by,me.membership.id);
 c.cookie='';c.csrf='';assert.equal((await c.call('/jobs/'+d.data.job_id)).status,200);await c.init();assert.equal((await c.call('/jobs/'+d.data.job_id+'/cancel','POST',{reason:'合成取消'})).status,200);
});
