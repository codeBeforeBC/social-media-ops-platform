import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const ledgerPath=resolve('docs/tracking/开发进度.md');
const states={'S0-05':'BLOCKED','S7-02':'VERIFY','S7-06':'VERIFY','S9-01':'DONE','S9-02':'VERIFY','S9-03':'DONE','S9-04':'DONE','S9-05':'DOING'};
const ledger='- 本轮执行范围：非数据验收（CHANGE-011）\n'+readFileSync(ledgerPath,'utf8').split('\n').filter(line=>!line.startsWith('- 本轮执行范围：')).map(line=>{
 const c=line.split('|'),id=c[1]?.trim();
 if(states[id]){c[5]=' '+states[id]+' ';if(['S9-03','S9-04','S9-05'].includes(id))c[4]=' S9-01 ';return c.join('|');}
 if(['T15','T16','T17','T23'].includes(id)){c[4]=id==='T15'?' BLOCKED ':' NOT_RUN ';return c.join('|');}
 return line;
}).join('\n').replace(/\]\(([^)]+)\)/g,(whole,url)=>/^(?:https?:|app:|codex:|#)/.test(url)?whole:']('+resolve(dirname(ledgerPath),url.split('#')[0])+')');
function check(text){
 const dir=mkdtempSync(resolve(tmpdir(),'yoyo-release-scope-'));
 try{
  for(const path of ['docs/tracking','docs/yoyo-workbench-v1.0','docs/evidence/s9','tools/s9'])mkdirSync(resolve(dir,path),{recursive:true});
  writeFileSync(resolve(dir,'docs/tracking/开发进度.md'),text);
  copyFileSync('docs/yoyo-workbench-v1.0/01-产品需求PRD.md',resolve(dir,'docs/yoyo-workbench-v1.0/01-产品需求PRD.md'));
  copyFileSync('tools/s9/release-gates.mjs',resolve(dir,'tools/s9/release-gates.mjs'));
  const run=spawnSync(process.execPath,['tools/s9/release-gates.mjs'],{cwd:dir,encoding:'utf8'});assert.equal(run.status,2,run.stderr);
  return JSON.parse(readFileSync(resolve(dir,'docs/evidence/s9/release-gates.json'),'utf8'));
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('full release checking still requires all 17 gates',()=>{
 const r=check(ledger.replace('- 本轮执行范围：非数据验收（CHANGE-011）','- 本轮执行范围：完整验收（测试夹具）'));
 assert.equal(r.execution_scope.kind,'full_release_acceptance');assert.equal(r.execution_scope.applicable_gate_count,17);assert.deepEqual(r.execution_scope.deferred_gates,[]);assert.equal(r.release_gates_satisfied,false);
});
test('deferred data remains unverified while RPO still blocks technical handoff',()=>{
 const r=check(ledger),s=r.execution_scope;
 assert.equal(s.applicable_gate_count,14);assert.deepEqual(s.deferred_gates,[{id:'T15',state:'BLOCKED'},{id:'T16',state:'NOT_RUN'},{id:'T17',state:'NOT_RUN'}]);
 assert.deepEqual(s.unmet_gates,[{id:'T23',state:'NOT_RUN'}]);assert.deepEqual(s.unmet_tasks,[{id:'S9-05',state:'DOING'}]);assert.equal(s.ready,false);assert.equal(r.release_gates_satisfied,false);
});
test('technical handoff readiness never becomes full release approval',()=>{
 const text=ledger.split('\n').map(line=>{
  if(line.startsWith('| S9-05 |'))return line.replace('| DOING |','| DONE |');
  if(line.startsWith('| T23 |'))return line.replace('| NOT_RUN |','| PASS |');
  return line;
 }).join('\n');
 const r=check(text);assert.equal(r.execution_scope.ready,true);assert.equal(r.execution_scope.passed_gate_count,14);assert.equal(r.passed_applicable_gate_count,14);assert.equal(r.release_gates_satisfied,false);assert.equal(r.result,'not_ready');assert.equal(r.unmet_gates.length,3);
});
