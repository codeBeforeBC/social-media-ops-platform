import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyIdentity,redactProbe} from '../tools/s0/probe-xhs-account-identity.mjs';
const id='abcdefabcdefabcdefabcdef',other='123456789012345678901234';
const snapshot={path:'/user/profile/'+id,own_ids:[id,id],current_user_id:id,nickname:'合成昵称',display_number:'合成展示号',login_wall:false,security_block:false};
test('登录身份必须有独立证据一致，目标主页与登录身份分别判断',()=>{
 assert.equal(classifyIdentity(snapshot,id).state,'matched');
 const wrong=classifyIdentity({...snapshot,own_ids:[other],current_user_id:other},id);assert.equal(wrong.state,'matched');assert.equal(wrong.session_matches_target,false);
 for(const patch of [{own_ids:[]},{own_ids:[id,other]},{current_user_id:other},{nickname:''},{display_number:null},{path:'/explore'}])assert.equal(classifyIdentity({...snapshot,...patch},id).state,'inconclusive');
});
test('登录墙/风控不重判为不存在；脱敏不输出原始昵称、展示号、链接或ID',()=>{
 assert.equal(classifyIdentity({...snapshot,login_wall:true},id).error_code,'AUTH_REQUIRED');assert.equal(classifyIdentity({...snapshot,security_block:true},id).error_code,'ACCESS_DENIED');
 const safe=redactProbe({target_id:id,steps:[{check:'public_profile',snapshot,result:classifyIdentity(snapshot,id)}]});const text=JSON.stringify(safe);
 for(const privateValue of [id,'合成昵称','合成展示号','own_ids','current_user_id'])assert.ok(!text.includes(privateValue));assert.equal(safe.steps[0].session_matches_target,true);
});
