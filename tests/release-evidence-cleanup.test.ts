import {test} from 'node:test';
import assert from 'node:assert/strict';
import {finishProbe} from '../tools/s9/acceptance-real-a';
test('统计失败仍删除临时配置、停止服务并写证据',()=>{const seen:string[]=[],failure=new Error('usage failed');assert.throws(()=>finishProbe(()=>{seen.push('usage');throw failure;},()=>seen.push('remove'),()=>seen.push('stop'),()=>seen.push('write')),e=>e===failure);assert.deepEqual(seen,['usage','remove','stop','write']);});
test('删除配置失败仍停止服务并写证据，不能掩盖失败',()=>{const seen:string[]=[];assert.throws(()=>finishProbe(()=>seen.push('usage'),()=>{seen.push('remove');throw Error('remove failed');},()=>seen.push('stop'),()=>seen.push('write')),/remove failed/);assert.deepEqual(seen,['usage','remove','stop','write']);});
test('停止服务失败仍写证据；正常路径依次执行',()=>{const seen:string[]=[];assert.throws(()=>finishProbe(()=>seen.push('usage'),()=>seen.push('remove'),()=>{seen.push('stop');throw Error('stop failed');},()=>seen.push('write')),/stop failed/);assert.deepEqual(seen,['usage','remove','stop','write']);const ok:string[]=[];finishProbe(()=>ok.push('usage'),()=>ok.push('remove'),()=>ok.push('stop'),()=>ok.push('write'));assert.deepEqual(ok,seen);});
