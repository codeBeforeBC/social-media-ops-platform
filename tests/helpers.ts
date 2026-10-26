import {randomUUID} from 'node:crypto';
import {AddressInfo} from 'node:net';
import {Database} from '../packages/db/src/db';
import {databaseUrl} from '../packages/domain/src/config';
import {migrate} from '../packages/db/src/migrate';
import {createApp} from '../apps/api/src/main';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import spec from '../contracts/openapi.json';
const ajv=new Ajv2020({strict:false,allErrors:true});addFormats(ajv);
const validators=new Map<string,ReturnType<typeof ajv.compile>>();
function checkContract(path:string,method:string,status:number,value:unknown){
  const route=Object.entries(spec.paths).sort(([a],[b])=>a.includes('{')===b.includes('{')?0:a.includes('{')?1:-1).find(([p])=>new RegExp('^'+p.replace(/\{[^}]+\}/g,'[^/]+')+'$').test(path.split('?')[0]!));
  const operation=(route?.[1] as any)?.[method.toLowerCase()];if(!operation||operation['x-implementation-status']!=='implemented')return;
  const schema=operation.responses[String(status)]?.content?.['application/json']?.schema;if(!schema)throw new Error(`Undocumented response ${method} ${path} ${status}`);
  const key=route![0]+method+status;if(!validators.has(key))validators.set(key,ajv.compile({...schema,components:spec.components}));
  const validate=validators.get(key)!;if(!validate(value))throw new Error(`Contract mismatch ${method} ${path}: ${JSON.stringify(validate.errors)}`);
}
export async function database(){const db=new Database(databaseUrl(true));await migrate(db);return db;}
export async function reset(db:Database){
  const name=new URL(databaseUrl(true)).pathname.slice(1);if(!name.endsWith('_test')||name==='yoyo_test'||process.env.ALLOW_TEST_RESET!==name)throw new Error('Reset requires an explicitly disposable database; preserved yoyo_test is forbidden');
  await db.query('TRUNCATE invitations,process_health,audit_logs,notifications,jobs,outbox,idempotency_records,login_limits,sessions,account_memberships,accounts,memberships,users,workspaces CASCADE');
  await db.query('UPDATE instance_state SET initialized_at=NULL WHERE id=1');
}
export class Client {
  cookie='';csrf='';
  constructor(readonly base:string){}
  async call(path:string,method='GET',body?:unknown,headers:Record<string,string>={}){
    const r=await fetch(this.base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,...(method!=='GET'?{Origin:'http://localhost:3000','X-CSRF-Token':this.csrf,'Idempotency-Key':randomUUID()}:{}),...headers},...(method!=='GET'?{body:JSON.stringify(body??{})}:{})});
    const set=r.headers.get('set-cookie');if(set)this.cookie=set.split(';')[0]!;
    const json=await r.json();checkContract(path,method,r.status,json);if(json.data?.csrf_token)this.csrf=json.data.csrf_token;return {status:r.status,data:json.data,error:json.error,headers:r.headers,meta:json.meta};
  }
  async init(){return this.call('/request/csrf');}

}
export async function server(){const db=new Database(databaseUrl(true));const table=(await db.query("SELECT to_regclass('public.schema_migrations') id")).rows[0].id;const prepared=table&&(await db.query("SELECT 1 FROM schema_migrations WHERE name='039-local-instance.sql'")).rowCount;if(prepared)await reset(db);await migrate(db);if(!prepared)await reset(db);const app=await createApp(db);await app.listen(0,'127.0.0.1');const address=app.getHttpServer().address() as AddressInfo;return {db,app,url:`http://127.0.0.1:${address.port}`,close:async()=>{await app.close();await db.close();}};}
export async function initialize(c:Client){
  await c.init();const data=(await c.call('/instance')).data;
  const db=new Database(databaseUrl(true));try{const row=(await db.query('SELECT m.id,m.user_id,m.workspace_id,m.roles,u.display_name FROM instance_state s JOIN memberships m ON m.id=s.default_member_id JOIN users u ON u.id=m.user_id WHERE s.id=1')).rows[0];return {workspace:data.workspace,user:{id:row.user_id,display_name:row.display_name},membership:{id:row.id,workspace_id:row.workspace_id,roles:row.roles}};}finally{await db.close();}
}
export async function legacyMember(db:Database,email:string,assigned=['admin'],active=true){
  const w=(await db.query('SELECT default_workspace_id id FROM instance_state WHERE id=1')).rows[0].id;
  const u=(await db.query('INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,NULL) RETURNING id',[email,email])).rows[0];
  return (await db.query('INSERT INTO memberships(workspace_id,user_id,roles,active) VALUES($1,$2,$3,$4) RETURNING *',[w,u.id,assigned,active])).rows[0];
}
