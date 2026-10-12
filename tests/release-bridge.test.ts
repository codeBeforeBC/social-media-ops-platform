import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {xhsCollector} from '../packages/domain/src/source-adapters';

test('release bridge uses the token file with empty env and keeps credential failures bounded',async()=>{
 const keys=['SOURCE_BRIDGE_URL','SOURCE_BRIDGE_TOKEN','SOURCE_BRIDGE_TOKEN_FILE'] as const;
 const previous=keys.map(key=>process.env[key]),dir=mkdtempSync(join(tmpdir(),'yoyo-s9-bridge-')),file=join(dir,'token');
 let expected='synthetic-file-token-for-release-check',requests=0;
 writeFileSync(file,expected+'\n',{mode:0o600});
 const server=createServer((req,res)=>{requests++;assert.equal(req.url,'/collect');assert.equal(req.headers.authorization,'Bearer '+expected);req.resume();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,result:{items:[],coverage:{classification:'synthetic_auth_boundary_only'},adapter_version:'synthetic-bridge-test'}}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  process.env.SOURCE_BRIDGE_URL='http://127.0.0.1:'+(server.address() as any).port;
  process.env.SOURCE_BRIDGE_TOKEN='';process.env.SOURCE_BRIDGE_TOKEN_FILE=file;
  const collect=()=>xhsCollector({source_type:'xhs_topic_signal',config:{profile:'synthetic'}},new AbortController().signal);
  assert.equal((await collect()).adapter_version,'synthetic-bridge-test');
  expected='synthetic-explicit-env-token';process.env.SOURCE_BRIDGE_TOKEN=expected;
  assert.equal((await collect()).adapter_version,'synthetic-bridge-test');
  process.env.SOURCE_BRIDGE_TOKEN='';process.env.SOURCE_BRIDGE_TOKEN_FILE=join(dir,'missing');
  await assert.rejects(collect(),(e:any)=>e.code==='ADAPTER_UNAVAILABLE'&&e.message==='ADAPTER_UNAVAILABLE');
  writeFileSync(file,'\n');process.env.SOURCE_BRIDGE_TOKEN_FILE=file;
  await assert.rejects(collect(),(e:any)=>e.code==='ADAPTER_UNAVAILABLE');assert.equal(requests,2);
 }finally{
  keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});
  server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(dir,{recursive:true,force:true});
 }
});
