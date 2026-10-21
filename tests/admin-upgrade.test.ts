import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {server,Client,initialize} from './helpers';
import {migrate} from '../packages/db/src/migrate';
import {storeResponse} from '../packages/domain/src/response-storage';

test('038升级保留身份/会话/归属，旧成员统一管理员且停用不复活，旧邀请重放返回当前权限',async()=>{
  const env=await server();
  try{
    const c=new Client(env.url),me=await initialize(c),key=randomUUID(),input={email:'upgrade@example.test'};
    const invited=await c.call('/members','POST',input,{'Idempotency-Key':key});assert.equal(invited.status,201);
    const pending=invited.data;
    // Recreate a pre-038 membership and its already encrypted invitation response.
    await env.db.query("UPDATE memberships SET roles=ARRAY['viewer'],active=false WHERE id=$1",[pending.id]);
    await env.db.query("UPDATE memberships SET roles=ARRAY['operator'] WHERE id=$1",[me.membership.id]);
    await env.db.query("UPDATE idempotency_records SET response=$1 WHERE actor_id=$2 AND key=$3",[JSON.stringify(storeResponse({...pending,roles:['viewer']})),me.membership.id,key]);
    await env.db.query("ALTER TABLE memberships ALTER COLUMN roles DROP DEFAULT");
    await env.db.query("DELETE FROM schema_migrations WHERE name='038-all-members-admin.sql'");
    const before=(await env.db.query('SELECT id,workspace_id,user_id,active,version FROM memberships ORDER BY id')).rows;
    const sessions=(await env.db.query('SELECT token_hash,user_id,workspace_id FROM sessions ORDER BY token_hash')).rows;
    await migrate(env.db);
    const after=(await env.db.query('SELECT id,workspace_id,user_id,active,version,roles FROM memberships ORDER BY id')).rows;
    assert.deepEqual(after.map(({roles,version,...m})=>m),before.map(({version,...m})=>m));
    assert.ok(after.every((m,i)=>m.roles.length===1&&m.roles[0]==='admin'&&m.version===before[i].version+1));
    assert.deepEqual((await env.db.query('SELECT token_hash,user_id,workspace_id FROM sessions ORDER BY token_hash')).rows,sessions);
    assert.deepEqual((await c.call('/me')).data.membership.roles,['admin']);
    const replay=await c.call('/members','POST',input,{'Idempotency-Key':key});assert.equal(replay.status,201);
    assert.equal(replay.data.invitation_token,pending.invitation_token);assert.deepEqual(replay.data.roles,['admin']);assert.equal(replay.data.active,false);
    assert.equal((await env.db.query("SELECT count(*)::int n FROM audit_logs WHERE action='membership.roles_unified'")).rows[0].n,2);
    await migrate(env.db);
    assert.deepEqual((await env.db.query('SELECT id,workspace_id,user_id,active,version,roles FROM memberships ORDER BY id')).rows,after);
  }finally{await env.close();}
});

test('旧state密钥升级后仍可解密历史邀请，新实例无需生成初始化凭据',()=>{
  const dir=mkdtempSync(tmpdir()+'/yoyo-admin-state-');
  try{
    const oldDir=dir+'/old',newDir=dir+'/new';
    mkdirSync(oldDir);
    writeFileSync(oldDir+'/instance.json',JSON.stringify({database_password:'synthetic-only',setup_token:'synthetic-legacy-key'}),{mode:0o600});
    const script=`
      import assert from 'node:assert/strict';
      import {execFileSync} from 'node:child_process';
      import {readFileSync} from 'node:fs';
      import {storeResponse,readResponse} from './packages/domain/src/response-storage';
      const value={invitation_token:'synthetic-invitation-only',roles:['viewer']};
      const encrypted=storeResponse(value);
      execFileSync(process.execPath,['tools/init-state.mjs'],{env:process.env});
      assert.deepEqual(readResponse(encrypted),value);
      const state=JSON.parse(readFileSync(process.env.STATE_DIR+'/instance.json','utf8'));
      assert.equal(state.idempotency_secret,state.setup_token);
    `;
    execFileSync('pnpm',['exec','tsx','-e',script],{env:{...process.env,STATE_DIR:oldDir},stdio:'pipe'});
    execFileSync(process.execPath,['tools/init-state.mjs'],{env:{...process.env,STATE_DIR:newDir},stdio:'pipe'});
    const state=JSON.parse(readFileSync(newDir+'/instance.json','utf8'));
    assert.ok(state.idempotency_secret);assert.equal(state.setup_token,undefined);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
