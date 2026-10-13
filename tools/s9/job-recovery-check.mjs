/** Compiled rc15 notification rollback/retry and import permission changes in the isolated clone. */
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const project='yoyo-s9-arm64-16',dir=resolve('.local/s9-clean-clone-rc15/.local/s9-runtime-arm64-16');
const env={...process.env,YOYO_VERSION:'0.1.0-s9rc15',HTTPS_ORIGIN:'https://localhost:3443',HTTPS_PORT:'3443',SOURCE_BRIDGE_URL:'',SOURCE_BRIDGE_TOKEN:''};
const args=['compose','--project-directory',dir,'-p',project,...['compose.yaml','compose.release.yaml','compose.https.yaml','compose.release-https.yaml'].flatMap(f=>['-f',dir+'/'+f])];
const compose=a=>execFileSync('docker',[...args,...a],{env,encoding:'utf8',maxBuffer:1000000});
const code=`(async()=>{
 const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Database}=require('./dist/packages/db/src/db.js'),{Jobs}=require('./dist/packages/domain/src/jobs.js'),{importParseHandler}=require('./dist/packages/domain/src/imports.js');
 const db=new Database();try{
  const member=(await db.query("SELECT * FROM memberships WHERE active AND 'admin'=ANY(roles) ORDER BY created_at LIMIT 1")).rows[0];assert.ok(member);
  const jobs=new Jobs(db);assert.equal((await db.query("SELECT count(*)::int n FROM jobs WHERE pool='general' AND state IN ('queued','running')")).rows[0].n,0);
  const insert=async(type,input={},account=null,creator=member.id)=>(await db.query("INSERT INTO jobs(workspace_id,account_id,created_by,type,pool,input,request_id) VALUES($1,$2,$3,$4,'general',$5,$6) RETURNING *",[member.workspace_id,account,creator,type,JSON.stringify(input),randomUUID()])).rows[0];
  const seed=await insert('system.check'),claimed=await jobs.claim('general');assert.equal(claimed.id,seed.id);
  jobs.handlers['system.check']=async j=>({result:{database:'ok'},effects:async tx=>{await tx.query("INSERT INTO notifications(workspace_id,recipient_id,event_key,job_id,title) VALUES($1,$2,$3,$4,'Synthetic notification failure')",[j.workspace_id,j.created_by,'diagnostic:'+j.id,j.id]);throw Error('SYNTHETIC_NOTIFICATION_FAILURE');}});
  await jobs.process(claimed);
  const failed=(await db.query('SELECT state,attempts,result,error_code FROM jobs WHERE id=$1',[seed.id])).rows[0];assert.equal(failed.state,'queued');assert.equal(failed.result,null);assert.equal(failed.error_code,'JOB_EXECUTION_FAILED');
  assert.equal((await db.query('SELECT count(*)::int n FROM notifications WHERE job_id=$1',[seed.id])).rows[0].n,0);assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE object_id=$1 AND action='job.succeeded'",[seed.id])).rows[0].n,0);
  const account=(await db.query('SELECT * FROM accounts WHERE workspace_id=$1 ORDER BY created_at LIMIT 1',[member.workspace_id])).rows[0];assert.ok(account);
  const user=(await db.query("INSERT INTO users(email,display_name,password_hash) VALUES($1,'Synthetic permission change','not-loginable') RETURNING id",['job-'+randomUUID()+'@example.test'])).rows[0];
  const operator=(await db.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['operator']) RETURNING id",[member.workspace_id,user.id])).rows[0];await db.query('INSERT INTO account_memberships(workspace_id,account_id,membership_id) VALUES($1,$2,$3)',[member.workspace_id,account.id,operator.id]);
  const parseJobs=new Jobs(db,{'import.parse':importParseHandler(db)}),parse=await insert('import.parse',{batch_id:randomUUID()},account.id,operator.id);const j=await parseJobs.claim('general');assert.equal(j.id,parse.id);
  const before=(await db.query('SELECT count(*)::int n FROM import_rows')).rows[0].n;const output=await parseJobs.handlers['import.parse'](j,new AbortController().signal);await db.query("UPDATE memberships SET roles=ARRAY['viewer'] WHERE id=$1",[operator.id]);
  assert.equal(await parseJobs.complete(j,output.result,output.effects,undefined,'succeeded',output.guard),false);const state=(await db.query('SELECT state,error_code,result FROM jobs WHERE id=$1',[parse.id])).rows[0];assert.equal(state.state,'failed');assert.equal(state.error_code,'IMPORT_SCOPE_CHANGED');assert.equal(state.result,null);assert.equal((await db.query('SELECT count(*)::int n FROM import_rows')).rows[0].n,before);
  console.log(JSON.stringify({retry_job_id:seed.id,notification_rollback:true,import_permission_guard:true}));
 }finally{await db.close();}
})().catch(e=>{console.error('COMPILED_JOB_RECOVERY_CHECK_FAILED',e.code??e.message);process.exitCode=1;});`;
let report={artifact:'0.1.0-s9rc15',classification:'synthetic_actual_compiled_transaction_failure_and_permission_change_actual_worker_retry',real_model_requests:0,checks:[]};
try{
 compose(['up','-d','--pull','never','--wait']);compose(['stop','worker']);
 const id=compose(['ps','-q','db']).trim(),[container]=JSON.parse(execFileSync('docker',['inspect',id],{encoding:'utf8'}));assert.equal(container.Config.Labels['com.docker.compose.project'],project);assert.ok(container.Mounts.some(m=>m.Name===project+'_database'));
 const result=JSON.parse(compose(['exec','-T','api','node','-e',code]));assert.ok(result.notification_rollback&&result.import_permission_guard);assert.match(result.retry_job_id,/^[a-f0-9-]{36}$/);
 report.checks.push('notification_insert_failure_rolls_back_result_notification_and_success_audit','import_scope_revoked_before_commit_refuses_rows_and_result');
 compose(['up','-d','--pull','never','--wait','worker']);let final;
 for(let i=0;i<60;i++){
  const q="SELECT json_build_object('state',state,'attempts',attempts,'result',result,'notifications',(SELECT count(*) FROM notifications WHERE job_id=jobs.id),'success_audits',(SELECT count(*) FROM audit_logs WHERE object_id=jobs.id AND action='job.succeeded'))::text FROM jobs WHERE id='"+result.retry_job_id+"'";
  final=JSON.parse(compose(['exec','-T','db','psql','-U','yoyo','-d','yoyo','-Atc',q]));if(final.state==='succeeded')break;await new Promise(r=>setTimeout(r,1000));
 }
 assert.equal(final.state,'succeeded');assert.equal(final.attempts,2);assert.equal(final.notifications,1);assert.equal(final.success_audits,1);assert.equal(final.result.database,'ok');report.final=final;report.checks.push('actual_worker_natural_backoff_retry_exactly_once_result_notification_and_audit');report.result='passed';
}catch(e){report.result='failed';console.error('JOB_RECOVERY_CHECK_FAILED',e.message);process.exitCode=1;}
finally{compose(['stop']);writeFileSync('docs/evidence/s9/job-recovery-rc15.json',JSON.stringify(report,null,2)+'\n');}
