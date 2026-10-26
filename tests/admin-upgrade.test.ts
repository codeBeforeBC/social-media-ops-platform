import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {server,Client,initialize,legacyMember} from './helpers';
import {migrate} from '../packages/db/src/migrate';
import {storeResponse,readResponse} from '../packages/domain/src/response-storage';

test('038/039升级保留旧身份和归属，停用不复活，旧邀请密文保留而接口退出',async()=>{
 const env=await server();try{
  const c=new Client(env.url),me=await initialize(c),pending=await legacyMember(env.db,'upgrade@example.test',['viewer'],false);
  const payload={id:pending.id,invitation_token:'synthetic-old-invitation',roles:['viewer']};const encrypted=storeResponse(payload);
  await env.db.query("UPDATE memberships SET roles=ARRAY['operator'] WHERE id=$1",[me.membership.id]);
  await env.db.query("UPDATE users SET password_hash='synthetic-existing-hash'");
  await env.db.query("ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL");
  await env.db.query('ALTER TABLE instance_state DROP COLUMN default_workspace_id,DROP COLUMN default_member_id');
  await env.db.query("DELETE FROM schema_migrations WHERE name IN ('038-all-members-admin.sql','039-local-instance.sql')");
  await env.db.query("INSERT INTO sessions(token_hash,csrf_hash,user_id,workspace_id,expires_at) VALUES('old-session','old-csrf',$1,$2,now()+interval '1 hour')",[me.user.id,me.workspace.id]);
  const before=(await env.db.query('SELECT id,workspace_id,user_id,active,version FROM memberships ORDER BY id')).rows;
  await migrate(env.db);
  const after=(await env.db.query('SELECT id,workspace_id,user_id,active,version,roles FROM memberships ORDER BY id')).rows;
  assert.deepEqual(after.map(({roles,version,...m})=>m),before.map(({version,...m})=>m));assert.ok(after.every((m,i)=>m.roles[0]==='admin'&&m.version===before[i].version+1));
  assert.equal((await c.call('/instance')).data.workspace.id,me.workspace.id);assert.equal((await env.db.query('SELECT default_member_id FROM instance_state WHERE id=1')).rows[0].default_member_id,me.membership.id);
  assert.equal((await env.db.query('SELECT count(*)::int n FROM sessions')).rows[0].n,0);assert.equal((await env.db.query('SELECT password_hash FROM users WHERE id=$1',[me.user.id])).rows[0].password_hash,'synthetic-existing-hash');
  assert.deepEqual(readResponse(encrypted),payload);assert.equal((await c.call('/members','POST',{})).status,410);
  await migrate(env.db);assert.deepEqual((await env.db.query('SELECT id,workspace_id,user_id,active,version,roles FROM memberships ORDER BY id')).rows,after);
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
