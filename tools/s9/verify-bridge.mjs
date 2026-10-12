/** Check the real loopback host Bridge from a release container; secrets enter only over stdin. */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const version=process.argv[2];assert.match(version??'',/^\d+\.\d+\.\d+-[a-z0-9.-]+$/);
const token=readFileSync('.local/state/source-bridge-token','utf8').trim();
assert.equal((await fetch('http://127.0.0.1:59025/health')).status,401);
const health=await fetch('http://127.0.0.1:59025/health',{headers:{Authorization:'Bearer '+token}});assert.equal(health.status,200);
const code=`(async()=>{
 let token='';for await(const chunk of process.stdin)token+=chunk;
 require('node:fs').writeFileSync('/tmp/source-bridge-token',token,{mode:0o600});
 process.env.SOURCE_BRIDGE_URL='http://host.docker.internal:59025';
 process.env.SOURCE_BRIDGE_TOKEN='';process.env.SOURCE_BRIDGE_TOKEN_FILE='/tmp/source-bridge-token';
 const result=await require('./dist/packages/domain/src/source-adapters.js').xhsCollector({source_type:'xhs_topic_signal',config:{profile:'zrcmcu2d',keywords:['旅行'],max_items:1}},AbortSignal.timeout(90000));
 process.stdout.write(JSON.stringify(result));
})().catch(e=>{console.error(e.code??'BRIDGE_PROBE_FAILED');process.exitCode=1;});`;
const output=execFileSync('docker',['run','--rm','--platform','linux/arm64','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,noexec,nosuid,size=16m,mode=1777','-i',`yoyo-release:${version}-arm64`,'node','-e',code],{input:token,encoding:'utf8',timeout:100000,maxBuffer:2000000});
mkdirSync('.local/s9-bridge-'+version,{recursive:true,mode:0o700});writeFileSync('.local/s9-bridge-'+version+'/result.json',output,{mode:0o600});
const result=JSON.parse(output);assert.equal(result.items.length,1);assert.equal(result.coverage.actual_source_type,'search');assert.deepEqual(result.coverage.keywords,['旅行']);assert.equal(result.capabilities.own_account_metrics,false);
for(const item of result.items){assert.equal(new URL(item.canonical_url).hostname,'www.xiaohongshu.com');assert.ok(!new URL(item.canonical_url).searchParams.has('xsec_token'));}
const report={checked_at:new Date().toISOString(),version,execution:'native_arm64_container_to_loopback_host_bridge',input_classification:'real_public_search_not_backend_metrics',unauthenticated_health:401,authenticated_health:200,empty_env_and_token_file_authentication:'passed',item_count:result.items.length,adapter_version:result.adapter_version,coverage:result.coverage,capabilities:result.capabilities,private_result_sha256:createHash('sha256').update(output).digest('hex'),credentials_printed:false,original_database_changed:false,result:'passed'};
writeFileSync('docs/evidence/s9/bridge-integration.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:'passed',received_items:result.items.length,credentials_printed:false}));
