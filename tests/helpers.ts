import {randomUUID} from 'node:crypto';
import {AddressInfo} from 'node:net';
import {Database} from '../packages/db/src/db';
import {databaseUrl,setupToken} from '../packages/domain/src/config';
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
  async init(){return this.call('/auth/csrf');}
  async login(email:string,password='A-safe-test-password-987'){await this.init();return this.call('/auth/login','POST',{email,password});}
}
export async function server(){const db=await database();await reset(db);const app=await createApp(db);await app.listen(0,'127.0.0.1');const address=app.getHttpServer().address() as AddressInfo;return {db,app,url:`http://127.0.0.1:${address.port}`,close:async()=>{await app.close();await db.close();}};}
export const adminInput={setup_token:()=>setupToken(),email:'admin@example.test',password:'A-safe-test-password-987',display_name:'测试管理员',workspace_name:'独立测试工作区'};
export async function initialize(c:Client){await c.init();const r=await c.call('/setup','POST',{...adminInput,setup_token:setupToken()});if(r.status!==201)throw new Error('Setup failed: '+r.error?.code);await c.login(adminInput.email);return (await c.call('/me')).data;}
