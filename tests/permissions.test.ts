import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authorize,Actor,permissions,canonical} from '../packages/domain/src/protocol';
test('03角色矩阵：组合角色取并集，只读不得下载原件或写业务',()=>{
  const a={roles:['viewer']} as Actor;
  authorize(a,'read');for(const p of ['admin','download.original','asset.edit','review','operate','content.production','content.copy'] as const)assert.throws(()=>authorize(a,p));
  const operator={roles:['operator']} as Actor;authorize(operator,'content.copy');authorize(operator,'operate');assert.throws(()=>authorize(operator,'content.production'));assert.throws(()=>authorize(operator,'asset.edit'));assert.throws(()=>authorize(operator,'review'));
  const editor={roles:['editor','reviewer']} as Actor;authorize(editor,'content.production');authorize(editor,'asset.edit');authorize(editor,'review');assert.throws(()=>authorize(editor,'admin'));
  assert.ok(permissions({roles:['admin']} as Actor).includes('admin'));
});
test('幂等请求哈希递归规范化对象键，保留数组顺序',()=>{assert.equal(canonical({b:{z:1,a:2},a:0}),canonical({a:0,b:{a:2,z:1}}));assert.notEqual(canonical([1,2]),canonical([2,1]));});
