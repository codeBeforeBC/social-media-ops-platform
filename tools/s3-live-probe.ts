/** Actual collection adapters through the API/Outbox/worker path, in the isolated test database. */
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Client,initialize,server} from '../tests/helpers';
import {Collection,SourceFailure} from '../packages/domain/src/collection';
import {sourceAdapters} from '../packages/domain/src/source-adapters';
import {saveSourceItems} from '../packages/domain/src/source-evidence';
import {Jobs} from '../packages/domain/src/jobs';
async function main(){
 const env=await server(),client=new Client(env.url);const report:any={started_at:new Date().toISOString(),environment:'native API/Outbox/worker; isolated *_test DB',profile:'zrcmcu2d',actual_sources:true,runs:[]};
 try{
  await initialize(client);const collection=new Collection(env.db,sourceAdapters,saveSourceItems);const jobs=new Jobs(env.db,{'source.collect':collection.handler});
  for(const source_type of (process.env.SOURCE_PROBE_TYPES??'weibo_hot,xhs_topic_signal,xhs_quality_note').split(',')){
   const now=new Date(),parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now),p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
   const created=await client.call('/source-connections','POST',{platform:source_type==='weibo_hot'?'weibo':'xiaohongshu',provider:source_type==='weibo_hot'?'weibo_web':'opencli',source_type,name:'真实来源验收 '+source_type,enabled:true,schedule:[`${p.hour}:${p.minute}`],config:process.env.SOURCE_PROBE_REFERENCE_CONFIG?{profile:'zrcmcu2d',keywords:['旅行','IP','潮玩','情绪价值'],max_items:source_type==='weibo_hot'?50:source_type==='xhs_quality_note'?6:4,...(source_type==='xhs_quality_note'?{reference_accounts:JSON.parse(readFileSync(process.env.SOURCE_PROBE_REFERENCE_CONFIG,'utf8')).reference_accounts}:{})}:{profile:'zrcmcu2d',keywords:['旅行'],max_items:3}});
   if(created.status!==201)throw new Error('SOURCE_CREATE_FAILED');await collection.tick(now);await jobs.dispatch();const job=await jobs.claim('general');if(!job)throw new Error('NO_SCHEDULED_JOB');
   let recovery:any=null;
   if(process.env.SOURCE_PROBE_RECOVERY==='1'&&source_type!=='weibo_hot'){
    const controlled=new Collection(env.db,{[source_type]:async()=>{throw new SourceFailure('AUTH_REQUIRED');}},saveSourceItems);
    await new Jobs(env.db,{'source.collect':controlled.handler}).process(job);
    const failed=(await client.call(`/source-connections/${created.data.id}`)).data;
    recovery={failure_kind:'explicit_controlled_AUTH_REQUIRED; not actual session expiry or human relogin',failed_at:new Date().toISOString(),health:failed.health,paused:failed.paused,notifications:(await env.db.query('SELECT count(*)::int n FROM notifications WHERE job_id=$1',[job.id])).rows[0].n,backoff_override:'last_attempt_at reset in isolated test DB; not elapsed production wait'};
    if(failed.health!=='auth_required'||!failed.paused||recovery.notifications<1)throw new Error('CONTROLLED_AUTH_FAILURE_NOT_PAUSED');
    await env.db.query('UPDATE source_connections SET last_attempt_at=NULL WHERE id=$1',[created.data.id]);
    const verify=await client.call(`/source-connections/${created.data.id}/verify`,'POST');if(verify.status!==202)throw new Error('RECOVERY_VERIFY_REJECTED');
    await jobs.dispatch();const restored=await jobs.claim('general');if(!restored)throw new Error('NO_VERIFY_JOB');await jobs.process(restored);
    const connection=(await client.call(`/source-connections/${created.data.id}`)).data;
    recovery.restored_at=new Date().toISOString();recovery.after_health=connection.health;recovery.after_paused=connection.paused;recovery.actual_provider_read=true;
    if(connection.paused||!['healthy','degraded'].includes(connection.health))throw new Error('REAL_PROVIDER_RECOVERY_FAILED');
   }else await jobs.process(job);
   const run=(await client.call(`/source-connections/${created.data.id}/runs`)).data.items[0];const items=(await client.call('/source-items?connection_id='+created.data.id)).data.items;
   report.runs.push({source_type,recovery,run_id:run.id,trigger:run.trigger,scheduled_slot:run.scheduled_slot,started_at:run.started_at,finished_at:run.finished_at,state:run.state,item_count:run.item_count,error_code:run.error_code,adapter_version:run.adapter_version,coverage:{...run.coverage,...(run.coverage?.reference_accounts?{reference_accounts:run.coverage.reference_accounts.map((a:any)=>({...a,account_id:undefined,account_id_sha256:createHash('sha256').update(a.account_id).digest('hex')}))}:{})},warnings:run.warnings,persisted_items:items.map((i:any)=>({item_id:i.id,external_id:i.external_id,title_sha256:createHash('sha256').update(i.title).digest('hex'),actual_source_type:i.actual_source_type,published_at:i.published_at,captured_at:i.captured_at,reference_only:i.reference_only,summary_chars:i.summary.length})),observation_count:(await env.db.query('SELECT count(*)::int n FROM source_observations WHERE run_id=$1',[run.id])).rows[0].n});
   console.log(JSON.stringify({source_type,state:run.state,item_count:run.item_count,error_code:run.error_code}));
  }
 }finally{report.finished_at=new Date().toISOString();mkdirSync('docs/evidence/s3',{recursive:true});writeFileSync(process.env.SOURCE_PROBE_REPORT??'docs/evidence/s3/source-worker-live-probe.json',JSON.stringify(report,null,2)+'\n');await env.close();}
 if(report.runs.length!==(process.env.SOURCE_PROBE_TYPES??'weibo_hot,xhs_topic_signal,xhs_quality_note').split(',').length||report.runs.some((r:any)=>r.state!=='succeeded'||r.item_count<1||r.item_count!==r.observation_count))process.exitCode=1;
}
main().catch(()=>{console.error('SOURCE_LIVE_PROBE_FAILED');process.exitCode=1;});
