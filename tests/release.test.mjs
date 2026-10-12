import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

test('release config needs no source builds, exports only HTTPS and keeps parsing isolated',()=>{
 for(const arch of ['arm64','amd64']){
  const c=JSON.parse(execFileSync('docker',['compose','--env-file','.env.example','-f','compose.yaml','-f','compose.release.yaml','-f','compose.https.yaml','-f','compose.release-https.yaml','config','--format','json'],{encoding:'utf8',env:{...process.env,YOYO_VERSION:'0.1.0-test',YOYO_ARCH:arch,SOURCE_BRIDGE_TOKEN:'untrusted-env-token'}}));
  for(const s of Object.values(c.services)){assert.equal(s.build,undefined);assert.equal(s.platform,'linux/'+arch);}
  assert.deepEqual(c.services.init.command,['node','tools/init-state.mjs']);
  assert.ok(c.services.init.volumes.every(v=>v.type==='volume'));
  for(const s of ['api','worker','media','scheduler']){assert.equal(c.services[s].environment.NODE_ENV,'production');assert.equal(c.services[s].environment.SOURCE_BRIDGE_TOKEN,'');assert.equal(c.services[s].environment.TRUST_PROXY,'1');}
  assert.equal(c.services.worker.environment.SOURCE_BRIDGE_TOKEN_FILE,'/state/source-bridge-token');
  assert.equal(c.services.api.ports,undefined);assert.equal(c.services.storage.ports,undefined);assert.equal(c.services.db.ports,undefined);
  assert.equal(c.services.proxy.ports[0].host_ip,'127.0.0.1');assert.equal(c.services.proxy.ports[0].target,443);
  assert.equal(c.services['media-executor'].read_only,true);assert.equal(c.networks.media.internal,true);
  assert.ok(c.services['media-executor'].volumes.every(v=>v.target!=='/state'));
 }
});
test('bundle builder refuses floating tags before any Docker operation',()=>{
 for(const version of ['latest','main','0.1.0;echo bad'])assert.notEqual(spawnSync('node',['tools/s9/release.mjs',version],{encoding:'utf8'}).status,0);
 assert.match(readFileSync('.github/workflows/ci.yml','utf8'),/ALLOW_TEST_RESET: yoyo_ci_test/);
});
