import {test} from 'node:test';
import assert from 'node:assert/strict';
import {referenceAccountId,referenceNoteIdentity} from '../tools/s3/xhs-reference.mjs';
const account='abcdefabcdefabcdefabcdef',note='123456789012345678901234';
test('公开主页ID严格限定；不接受其他域名、登录凭据或签名URL作为配置',()=>{
 assert.equal(referenceAccountId(account.toUpperCase()),account);
 assert.equal(referenceAccountId(`https://www.xiaohongshu.com/user/profile/${account}`),account);
 for(const raw of [`https://evil.example/user/profile/${account}`,`https://www.xiaohongshu.com/user/profile/${account}?xsec_token=private`, `https://user:pass@www.xiaohongshu.com/user/profile/${account}`, 'file:///tmp/profile', '../user'])assert.throws(()=>referenceAccountId(raw),{code:'INVALID_INPUT'});
});
test('账号笔记校验作者与笔记ID，规范链接剥离签名并拒绝错账号',()=>{
 const raw=`https://www.xiaohongshu.com/user/profile/${account}/${note}?xsec_token=test-private&xsec_source=pc_user`;
 assert.deepEqual(referenceNoteIdentity(raw,account),{id:note,canonical_url:`https://www.xiaohongshu.com/explore/${note}`});
 assert.throws(()=>referenceNoteIdentity(raw,'111111111111111111111111'),{code:'SOURCE_CHANGED'});
 assert.throws(()=>referenceNoteIdentity(raw.replace('www.xiaohongshu.com','evil.example'),account),{code:'SOURCE_CHANGED'});
});
