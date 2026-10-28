import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSourceBridge} from '../tools/s3/source-bridge.mjs';
import {publicIdentity} from '../tools/s3/xhs-account-verify.mjs';
const token='synthetic-account-bridge-token-123456789',target='abcdefabcdefabcdefabcdef';
test('固定动作鉴权、档案校验和同档案采集/验证互斥，错误后释放锁',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let calls=0;
 const server=createSourceBridge({token,profiles:async()=>[{id:'actual'}],canonical:async p=>p==='alias'?'actual':p,run:async(script,input)=>{calls++;entered();await gate;return {ok:true,result:{script,profile:input.profile??input.config.profile}};}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const call=(path,body,auth=token)=>fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await call('/profiles',null,'wrong')).status,401);assert.deepEqual((await(await call('/profiles')).json()).items,[{id:'actual'}]);
  assert.equal((await call('/accounts/verify',{profile:'../private',target_id:target})).status,422);
  assert.equal((await call('/accounts/verify',{profile:'actual',target_id:target,script:'arbitrary'})).status,422);
  assert.equal((await call('/accounts/verify',{profile:'disconnected',target_id:target})).status,422);
  assert.equal((await call('/accounts/verify',{profile:'alias',target_id:target})).status,422);
  const collect=call('/collect',{source_type:'xhs_quality_note',config:{profile:'alias'}});await started;
  assert.equal((await call('/accounts/verify',{profile:'actual',target_id:target})).status,409);release();assert.equal((await collect).status,200);
  const verified=await call('/accounts/verify',{profile:'actual',target_id:target});assert.equal(verified.status,200);assert.equal(calls,2);
  assert.equal((await call('/anything',{profile:'actual'})).status,404);
 }finally{release();await new Promise(r=>server.close(r));}
});
test('公开身份独立于登录身份；仅路径存在/空资料/登录墙不能成为账号匹配',()=>{
 const snapshot={path:'/user/profile/'+target,nickname:'合成资料',display_number:'合成展示号'};
 assert.equal(publicIdentity(snapshot,target).status,'matched');
 for(const patch of [{path:'/user/profile/111111111111111111111111'},{nickname:''},{display_number:null},{login_wall:true},{security_block:true}])assert.equal(publicIdentity({...snapshot,...patch},target).status,'inconclusive');
 assert.equal(publicIdentity({...snapshot,login_wall:true},target).code,'AUTH_REQUIRED');
});
