import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {server,Client,initialize,reset} from './helpers';
import {ensureInstance} from '../packages/domain/src/instance';
import {Jobs} from '../packages/domain/src/jobs';
import {AccountVerificationTasks,AccountVerificationResult} from '../packages/domain/src/account-verifications';
import {AppError} from '../packages/domain/src/protocol';
let env:Awaited<ReturnType<typeof server>>,c:Client;
const fid=()=>randomUUID().replaceAll('-','').slice(0,24);
const result=(id:string,session=id):AccountVerificationResult=>({public_status:'matched',session_status:session===id?'matched':'mismatched',public_profile:{id,nickname:'合成平台昵称',display_handle:'合成展示号'},session_id:session,observed_at:new Date().toISOString(),adapter_version:'controlled-account-v1',capabilities:{public_identity:'supported',current_session_identity:'supported',own_account_metrics:'unknown'},error_code:session===id?null:'ACCOUNT_MISMATCH'});
before(async()=>{env=await server();});after(async()=>env.close());beforeEach(async()=>{await reset(env.db);await ensureInstance(env.db);c=new Client(env.url);await initialize(c);});
async function account(){const r=await c.call('/accounts','POST',{platform:'xiaohongshu',platform_user_id:fid(),name:'明确合成验证账号',browser_profile_ref:'controlled-profile'});assert.equal(r.status,201);return r.data;}
async function start(a:any,headers:Record<string,string>={}){return c.call(`/accounts/${a.id}/verifications`,'POST',{expected_version:a.version,binding_version:a.identity_binding_version},headers);}
async function run(reader:(a:any,s:AbortSignal)=>Promise<unknown>){const jobs=new Jobs(env.db,{'account.verify':new AccountVerificationTasks(env.db,reader).handler});await jobs.dispatch();const j=await jobs.claim('general');assert.ok(j);await jobs.process(j);return j;}
async function get(a:any){return (await c.call('/accounts/'+a.id)).data;}
test('活动验证复用、Outbox恢复不重复、60秒冷却及错误版本有明确结果',async()=>{
 const a=await account(),one=await start(a),two=await start(a);assert.equal(one.status,202);assert.equal(two.data.reused,true);assert.equal(one.data.verification.id,two.data.verification.id);
 assert.equal((await start({...a,identity_binding_version:2})).status,409);
 const j=await run(async()=>result(a.platform_user_id));assert.equal((await c.call('/jobs/'+j.id)).data.state,'succeeded');
 assert.equal((await env.db.query('SELECT count(*)::int n FROM jobs')).rows[0].n,1);assert.equal((await start(a)).status,429);
});
test('公开身份与登录身份分别保存，人工确认记录不可伪造，不改本地备注',async()=>{
 const a=await account();await start(a);await run(async()=>result(a.platform_user_id,fid()));const ac=await get(a),v=ac.verification.latest;
 assert.equal(v.state,'partial');assert.equal(v.result.public_status,'matched');assert.equal(v.result.session_status,'mismatched');assert.equal(ac.name,a.name);assert.equal(ac.verification.confirmed,false);
 const path=`/accounts/${a.id}/identity-confirmation`;assert.equal((await c.call(path,'POST',{verification_id:v.id,expected_version:ac.version,confirmed:false})).status,422);
 const r=await c.call(path,'POST',{verification_id:v.id,expected_version:ac.version,confirmed:true});assert.equal(r.status,200);assert.equal((await get(a)).verification.confirmed,true);assert.equal((await get(a)).verification.latest.result.session_status,'mismatched');
 await assert.rejects(env.db.query("UPDATE account_verifications SET result='{}' WHERE id=$1",[v.id]),/immutable/);
});
test('更换档案清除当前确认并增加绑定版本，单改备注不使身份观察失效',async()=>{
 const a=await account();await start(a);await run(async()=>result(a.platform_user_id));const ac=await get(a),v=ac.verification.latest;
 await c.call(`/accounts/${a.id}/identity-confirmation`,'POST',{verification_id:v.id,expected_version:ac.version,confirmed:true});let latest=await get(a);
 const renamed=await c.call('/accounts/'+a.id,'PATCH',{name:'备注已更正',expected_version:latest.version});assert.equal(renamed.status,200);assert.equal((await get(a)).verification.confirmed,true);
 latest=await get(a);const changed=await c.call('/accounts/'+a.id,'PATCH',{browser_profile_ref:'other-profile',expected_version:latest.version});assert.equal(changed.status,200);assert.equal(changed.data.identity_binding_version,2);assert.equal(changed.data.confirmed_verification_id,null);assert.equal((await get(a)).verification.current,false);
 assert.equal((await c.call(`/accounts/${a.id}/identity-confirmation`,'POST',{verification_id:v.id,expected_version:changed.data.version,confirmed:true})).status,422);
});
test('换绑定后迟到结果不能生效，也不能覆盖新绑定',async()=>{
 const a=await account();await start(a);let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),began=new Promise<void>(r=>entered=r);
 const work=run(async()=>{entered();await gate;return result(a.platform_user_id);});await began;
 await c.call('/accounts/'+a.id,'PATCH',{browser_profile_ref:'replacement',expected_version:a.version});release();const job=await work;
 const stored=(await c.call('/jobs/'+job.id)).data;assert.equal(stored.state,'failed');assert.equal(stored.error_code,'STALE_INPUT');assert.equal((await get(a)).verification.latest.applied_at,null);
});
test('取消后结果不落库，重新验证创建新记录而非篡改原历史',async()=>{
 const a=await account();const accepted=await start(a);let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),began=new Promise<void>(r=>entered=r);
 const work=run(async()=>{entered();await gate;return result(a.platform_user_id);});await began;await c.call('/jobs/'+accepted.data.verification.job_id+'/cancel','POST',{reason:'合成取消'});release();await work;
 let ac=await get(a);assert.equal(ac.verification.latest.state,'cancelled');assert.equal(ac.verification.latest.result,null);
 await env.db.query("UPDATE accounts SET verification_next_at=now()-interval '1 second' WHERE id=$1",[a.id]);const next=await start(ac);assert.equal(next.status,202);assert.notEqual(next.data.verification.id,accepted.data.verification.id);
});
test('登录失效/离线/忙等业务失败终态保留，不自动重试；通用重试拒绝改写验证历史',async()=>{
 const a=await account();await start(a);let calls=0;const job=await run(async()=>{calls++;throw new AppError(503,'BROWSER_UNAVAILABLE','合成离线');});const ac=await get(a);assert.equal(calls,1);assert.equal(ac.verification.latest.state,'failed');assert.equal(ac.verification.latest.result.error_code,'BROWSER_UNAVAILABLE');
 const jobs=new Jobs(env.db);assert.equal(await jobs.claim('general'),null);assert.equal((await c.call('/jobs/'+job.id+'/retry','POST',{reason:'合成重试'})).error.code,'ACCOUNT_VERIFICATION_RETRY_REQUIRED');
});
test('不可靠目标/错登录结论/过期观察和任意多余字段不能成为匹配结果',async()=>{
 for(const bad of ['wrong-target','wrong-session','old-observation','extra']){
  const a=await account();await start(a);await run(async()=>{const r:any=result(a.platform_user_id);if(bad==='wrong-target')r.public_profile.id=fid();if(bad==='wrong-session')r.session_id=fid();if(bad==='old-observation')r.observed_at='2020-01-01T00:00:00.000Z';if(bad==='extra')r.cookie='never-propagate';return r;});const ac=await get(a);assert.equal(ac.verification.latest.result.public_status,'inconclusive');assert.ok(!JSON.stringify(ac).includes('never-propagate'));
 }
});
test('缺档案、路径注入、无效旧ID、跨账号验证记录与24小时过期确认均受服务端拒绝',async()=>{
 const a=await account(),b=await account();assert.equal((await c.call('/accounts/'+a.id,'PATCH',{browser_profile_ref:'/tmp/profile',expected_version:a.version})).status,422);
 const no=(await c.call('/accounts/'+a.id,'PATCH',{browser_profile_ref:null,expected_version:a.version})).data;assert.equal((await start(no)).error.code,'PROFILE_REQUIRED');
 const queued=await start(b),vid=queued.data.verification.id;assert.equal((await c.call(`/accounts/${a.id}/verifications/${vid}`)).status,404);
 const old=result(b.platform_user_id);old.observed_at='2020-01-01T00:00:00.000Z';await env.db.query('UPDATE account_verifications SET result=$2,applied_at=now() WHERE id=$1',[vid,JSON.stringify(old)]);await env.db.query("UPDATE jobs SET state='succeeded',finished_at=now() WHERE id=$1",[queued.data.verification.job_id]);
 assert.equal((await c.call(`/accounts/${b.id}/identity-confirmation`,'POST',{verification_id:vid,expected_version:b.version,confirmed:true})).error.code,'STALE_VERIFICATION');
 await env.db.query("UPDATE accounts SET platform_user_id='old-bad-id' WHERE id=$1",[a.id]);const ref=(await c.call('/accounts/'+a.id,'PATCH',{browser_profile_ref:'controlled-profile',expected_version:no.version})).data;assert.equal((await start(ref)).error.code,'INVALID_ACCOUNT_ID');
});
test('最近失败醒目保留、历史成功可查、历史有界分页不跨账号',async()=>{
 const a=await account();await start(a);await run(async()=>result(a.platform_user_id));await env.db.query('UPDATE accounts SET verification_next_at=NULL WHERE id=$1',[a.id]);await start(a);await run(async()=>({...result(a.platform_user_id),public_status:'inconclusive',public_profile:null,session_status:'auth_required',session_id:null,error_code:'AUTH_REQUIRED'}));const ac=await get(a);
 assert.equal(ac.verification.latest.state,'failed');assert.equal(ac.verification.last_success.result.public_status,'matched');assert.notEqual(ac.verification.latest.id,ac.verification.last_success.id);
 const first=(await c.call(`/accounts/${a.id}/verifications?limit=1`)).data;assert.equal(first.items.length,1);assert.ok(first.next_cursor);const next=(await c.call(`/accounts/${a.id}/verifications?limit=1&cursor=${first.next_cursor}`)).data;assert.notEqual(first.items[0].id,next.items[0].id);
});
test('档案发现只走固定鉴权桥接路径，返回白名单字段，不暴露桥接令牌',async()=>{
 const previous=[process.env.SOURCE_BRIDGE_URL,process.env.SOURCE_BRIDGE_TOKEN];const token='synthetic-account-bridge-token-no-real-secret';
 const bridge=createServer((req,res)=>{assert.equal(req.url,'/profiles');assert.equal(req.headers.authorization,'Bearer '+token);res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,items:[{id:'controlled-profile'}]}));});await new Promise<void>(r=>bridge.listen(0,'127.0.0.1',r));
 try{process.env.SOURCE_BRIDGE_URL='http://127.0.0.1:'+(bridge.address() as any).port;process.env.SOURCE_BRIDGE_TOKEN=token;const response=await c.call('/account-browser-profiles');assert.equal(response.status,200);assert.deepEqual(response.data,{items:[{id:'controlled-profile'}]});assert.ok(!JSON.stringify(response).includes(token));}finally{process.env.SOURCE_BRIDGE_URL=previous[0];process.env.SOURCE_BRIDGE_TOKEN=previous[1];await new Promise<void>(r=>bridge.close(()=>r()));}
});

test('确认幂等重放不会恢复换档案前的声明，数据库仍拒绝跨账号确认与跨空间记录',async()=>{
 const a=await account();await start(a);await run(async()=>result(a.platform_user_id));const ac=await get(a),v=ac.verification.latest,key=randomUUID(),body={verification_id:v.id,expected_version:ac.version,confirmed:true},path=`/accounts/${a.id}/identity-confirmation`;
 const confirmed=await c.call(path,'POST',body,{'Idempotency-Key':key});assert.equal(confirmed.status,200);
 await c.call('/accounts/'+a.id,'PATCH',{browser_profile_ref:'replacement',expected_version:confirmed.data.version});const replay=await c.call(path,'POST',body,{'Idempotency-Key':key});assert.equal(replay.status,200);assert.equal(replay.data.confirmed_verification_id,null);
 const b=await account();await assert.rejects(env.db.query('UPDATE accounts SET confirmed_verification_id=$2 WHERE id=$1',[b.id,v.id]),(e:any)=>e.code==='23503');
 const w=(await env.db.query("INSERT INTO workspaces(name) VALUES('其他隔离空间') RETURNING id")).rows[0].id;
 const u=(await env.db.query("INSERT INTO users(email,display_name) VALUES('verification-foreign@example.test','合成身份') RETURNING id")).rows[0].id;
 const m=(await env.db.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['admin']) RETURNING id",[w,u])).rows[0].id;
 const foreign=(await env.db.query("INSERT INTO accounts(workspace_id,platform,platform_user_id,name,owner_id) VALUES($1,'xiaohongshu',$2,'其他空间账号',$3) RETURNING id",[w,fid(),m])).rows[0].id;
 assert.equal((await c.call(`/accounts/${foreign}/verifications`)).status,404);assert.equal((await c.call(`/accounts/${foreign}/verifications/${v.id}`)).status,404);
 await env.db.query("UPDATE memberships SET roles=ARRAY['viewer'] WHERE workspace_id<>$1",[w]);assert.equal((await start(b)).status,403);
});
test('新任务白名单保留旧退出范围并拒绝错误执行池和缺少身份的验证任务',async()=>{
 for(const [type,pool,input,expected] of [['account.verify','general',{verification_id:randomUUID()},true],['account.verify','media',{verification_id:randomUUID()},false],['account.verify','general',{},false],['content.render','general',{},false],['source.collect','general',{run_id:randomUUID()},true]] as const){assert.equal((await env.db.query('SELECT yoyo_job_supported($1,$2,$3) allowed',[type,pool,JSON.stringify(input)])).rows[0].allowed,expected);}
});

test('旧库大写内部ID按规范身份验证且能确认，新登记不能形成同身份重复',async()=>{
 const a=await account();await env.db.query('UPDATE accounts SET platform_user_id=upper(platform_user_id) WHERE id=$1',[a.id]);const legacy=await get(a);await start(legacy);await run(async()=>result(a.platform_user_id));const current=await get(a);assert.equal(current.verification.latest.state,'succeeded');
 const confirmed=await c.call(`/accounts/${a.id}/identity-confirmation`,'POST',{verification_id:current.verification.latest.id,expected_version:current.version,confirmed:true});assert.equal(confirmed.status,200);assert.equal((await get(a)).platform_user_id,legacy.platform_user_id);
 const duplicate=await c.call('/accounts','POST',{platform:'xiaohongshu',platform_user_id:a.platform_user_id,name:'不应重复登记旧身份'});assert.equal(duplicate.status,409);assert.equal(duplicate.error.field_errors.account_id,a.id);
});
