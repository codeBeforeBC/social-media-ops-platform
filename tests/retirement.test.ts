import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {Database} from '../packages/db/src/db';
import {migrate} from '../packages/db/src/migrate';
import {Jobs} from '../packages/domain/src/jobs';
import {Client,initialize} from './helpers';
import {createApp} from '../apps/api/src/main';
import {AddressInfo} from 'node:net';
test('T25真实旧库结构升级：角色不提权、在途旧Job拒绝提交、关系/幂等/通知退出而通用事件保留',async()=>{
 const name='yoyo_s11_race_'+Date.now()+'_test';const url=new URL(process.env.TEST_DATABASE_URL!);const adminUrl=new URL(url);adminUrl.pathname='/postgres';const admin=new Database(adminUrl.toString());try{await admin.query(`CREATE DATABASE ${name}`);}finally{await admin.close();}url.pathname='/'+name;const db=new Database(url.toString());let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{
  await db.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const file of readdirSync('packages/db/migrations').filter(f=>f.endsWith('.sql')&&f<'025').sort()){const sql=readFileSync('packages/db/migrations/'+file,'utf8');await db.transaction(async tx=>{await tx.query(sql);await tx.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[file,createHash('sha256').update(sql).digest('hex')]);});}
  app=await createApp(db);await app.listen(0,'127.0.0.1');const c=new Client('http://127.0.0.1:'+(app.getHttpServer().address() as AddressInfo).port);const me=await initialize(c),w=me.workspace.id,m=me.membership.id,account=(await c.call('/accounts','POST',{name:'合成升级账号',platform:'xiaohongshu',platform_user_id:'race'})).data;
  const reviewer=(await db.query("INSERT INTO users(email,display_name,password_hash) VALUES('legacy-review@example.invalid','旧审核者','unusable') RETURNING id")).rows[0].id;
  const member=(await db.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['editor','reviewer']) RETURNING id",[w,reviewer])).rows[0].id;await db.query('INSERT INTO account_memberships VALUES($1,$2,$3)',[w,account.id,member]);
  const content=(await db.query("INSERT INTO contents(workspace_id,account_id,created_by,title,media_type) VALUES($1,$2,$3,'原始标题','graphic') RETURNING id",[w,account.id,m])).rows[0].id;
  const revision=(await db.query('INSERT INTO content_revisions(workspace_id,content_id,created_by,revision_no) VALUES($1,$2,$3,1) RETURNING id',[w,content,m])).rows[0].id;
  const note=(await db.query("INSERT INTO publications(workspace_id,account_id,content_id,revision_id,current_revision_id,platform_note_id,url,published_at,recorded_by,traffic_type,is_campaign) VALUES($1,$2,$3,$4,$4,'legacy','https://www.xiaohongshu.com/explore/legacy',now()-interval '1 day',$5,'organic',false) RETURNING *",[w,account.id,content,revision,m])).rows[0];
  const request=(await db.query("INSERT INTO ai_requests(workspace_id,account_id,created_by,kind,input_version,snapshot,state) VALUES($1,$2,$3,'topics','legacy','{}','succeeded') RETURNING id",[w,account.id,m])).rows[0].id;
  const topic=(await db.query("INSERT INTO topics(workspace_id,account_id,created_by,generation_request_id,candidate_position,candidate,score,status,accepted_content_id,accepted_revision_id,accepted_owner_id) VALUES($1,$2,$3,$4,1,'{}',0,'accepted',$5,$6,$3) RETURNING id",[w,account.id,m,request,content,revision])).rows[0].id;
  const decision=(await db.query("INSERT INTO topic_decisions(workspace_id,topic_id,actor_id,decision,reason,content_id) VALUES($1,$2,$3,'accepted','旧人工决定',$4) RETURNING id",[w,topic,m,content])).rows[0].id;
  await db.query("INSERT INTO idempotency_records(workspace_id,actor_id,method,route,key,request_hash,status,response) VALUES($1,$2,'POST',$3,'legacy-key','legacy',201,$4)",[w,m,'/topics/'+topic+'/accept',JSON.stringify({content_id:content,revision_id:revision,brief_job_id:randomUUID()})]);
  const pending=[];for(const [type,pool] of [['content.export','general'],['media.preview','media'],['system.check','reminder'],['calendar.remind','general'],['publication.recorded','general']]){const j=(await db.query("INSERT INTO jobs(workspace_id,created_by,type,pool,request_id,state,lease_token,lease_until) VALUES($1,$2,$3,$4,$5,'running',$6,now()+interval '1 hour') RETURNING *",[w,m,type,pool,randomUUID(),randomUUID()])).rows[0];pending.push(j);await db.query('INSERT INTO notifications(workspace_id,recipient_id,event_key,job_id,title,task_ref) VALUES($1,$2,$3,$4,$5,$6)',[w,m,'legacy:'+j.id,j.id,'旧任务通知','job:'+j.id]);}
  await db.query("INSERT INTO outbox(workspace_id,event_key,event_type,payload) VALUES($1,'legacy-publication','publication.recorded',$2)",[w,JSON.stringify({created_by:m,request_id:randomUUID(),pool:'general'})]);
  await db.query("INSERT INTO outbox(workspace_id,event_key,event_type,payload) VALUES($1,'general-stays','system.check',$2)",[w,JSON.stringify({created_by:m,request_id:randomUUID(),pool:'general'})]);
  const generic=(await db.query("INSERT INTO jobs(workspace_id,created_by,type,pool,request_id) VALUES($1,$2,'system.custom','general',$3) RETURNING id",[w,m,randomUUID()])).rows[0].id;await migrate(db);assert.equal((await db.query('SELECT state FROM jobs WHERE id=$1',[generic])).rows[0].state,'queued');await db.query("UPDATE jobs SET state='cancelled',cancel_requested=true WHERE id=$1",[generic]);const jobs=new Jobs(db);let effects=0;
  for(const j of pending){assert.equal((await db.query('SELECT state,error_code FROM jobs WHERE id=$1',[j.id])).rows[0].state,'cancelled');assert.equal(await jobs.complete(j,{},async()=>{effects++;}),false);await assert.rejects(db.query("UPDATE jobs SET state='succeeded' WHERE id=$1",[j.id]),/SCOPE_RETIRED/);}
  assert.equal(effects,0);assert.deepEqual((await db.query('SELECT roles FROM memberships WHERE id=$1',[member])).rows[0].roles,['editor','viewer']);assert.equal((await db.query('SELECT count(*)::int n FROM account_memberships WHERE membership_id=$1',[member])).rows[0].n,1);
  assert.equal((await db.query('SELECT id,title,media_type FROM publications WHERE id=$1',[note.id])).rows[0].title,'原始标题');assert.equal((await db.query('SELECT owner_id FROM topic_decisions WHERE id=$1',[decision])).rows[0].owner_id,m);assert.ok((await db.query("SELECT legacy->>'content_id' id FROM retired.relationships WHERE entity='publication' AND id=$1",[note.id])).rows[0].id===content);
  const r=await c.call('/topics/'+topic+'/accept','POST',{expected_version:1},{'Idempotency-Key':'legacy-key'});assert.equal(r.status,200);assert.equal(r.data.decision_id,decision);assert.equal('content_id' in r.data,false);
  assert.equal((await db.query('SELECT count(*)::int n FROM notifications WHERE superseded_at IS NOT NULL AND task_ref IS NULL')).rows[0].n,pending.length);
  await assert.rejects(db.query('UPDATE retired.contents SET title=$2 WHERE id=$1',[content,'旧worker迟到写入']),/Immutable/);
  assert.equal(await jobs.dispatch(),1);const general=(await jobs.claim('general'))!;assert.equal(general.type,'system.check');await jobs.process(general);assert.equal((await db.query('SELECT count(*)::int n FROM notifications WHERE job_id=$1',[general.id])).rows[0].n,1);
 }finally{await app?.close();await db.close();}
});
