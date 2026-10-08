import {randomUUID} from 'node:crypto';
import {Database,Tx} from '../../db/src/db';
import {config} from './config';
type Job=Record<string,any>;
export type JobHandler=(job:Job,signal:AbortSignal)=>Promise<{result:unknown;effects?:(tx:Tx)=>Promise<void>;cleanup?:(applied:boolean)=>Promise<void>}>;
export class Jobs {
  readonly handlers:Record<string,JobHandler>;
  constructor(readonly db:Database,handlers:Record<string,JobHandler>={}){
    this.handlers={'system.check':async(j,signal)=>{await db.query('SELECT 1');if(signal.aborted)throw new Error('JOB_TIMEOUT');return {result:{database:'ok',pool:j.pool},effects:async tx=>{
      await tx.query(`INSERT INTO notifications(workspace_id,recipient_id,event_key,job_id,title,task_ref) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[j.workspace_id,j.created_by,'diagnostic:'+j.id,j.id,'运行检查完成',`job:${j.id}`]);
    }};},...handlers};
  }
  async dispatch(){
    return this.db.transaction(async tx=>{
      const rows=await tx.query('SELECT * FROM outbox WHERE dispatched_at IS NULL AND available_at<=now() ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 50');
      for(const event of rows.rows){
        const p=event.payload;
        await tx.query(`INSERT INTO jobs(workspace_id,account_id,created_by,outbox_id,type,pool,input,input_version,request_id,timeout_seconds) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $6='media' THEN 1800 ELSE 120 END) ON CONFLICT(outbox_id) DO NOTHING`,[event.workspace_id,event.account_id,p.created_by,event.id,event.event_type,p.pool??'general',JSON.stringify(p.input??{}),p.input_version??null,p.request_id]);
        await tx.query('UPDATE outbox SET dispatched_at=now() WHERE id=$1',[event.id]);
      }return rows.rowCount;
    });
  }
  async claim(pool:string):Promise<Job|null>{
    return this.db.transaction(async tx=>{
      const exhausted=await tx.query(`UPDATE jobs SET state='failed',error_code='ATTEMPTS_EXHAUSTED',finished_at=now(),lease_token=NULL,lease_until=NULL,version=version+1 WHERE pool=$1 AND state='running' AND lease_until<now() AND attempts>=max_attempts RETURNING *`,[pool]);
      for(const j of exhausted.rows)await this.event(tx,j,'job.failed',{error_code:'ATTEMPTS_EXHAUSTED'});
      const row=await tx.query(`SELECT * FROM jobs WHERE pool=$1 AND cancel_requested=false AND attempts<max_attempts AND ((state='queued' AND available_at<=now()) OR (state='running' AND lease_until<now())) ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,[pool]);
      if(!row.rowCount)return null;
      const r=await tx.query(`UPDATE jobs SET state='running',attempts=attempts+1,lease_token=$1,lease_until=now()+$2::int*interval '1 second',heartbeat_at=now(),started_at=now(),finished_at=NULL,version=version+1,updated_at=now() WHERE id=$3 RETURNING *`,[randomUUID(),config.leaseSeconds,row.rows[0].id]);return r.rows[0];
    });
  }
  async heartbeat(j:Job){const r=await this.db.query(`UPDATE jobs SET heartbeat_at=now(),lease_until=now()+$1::int*interval '1 second' WHERE id=$2 AND state='running' AND lease_token=$3 AND lease_until>now() AND cancel_requested=false`,[config.leaseSeconds,j.id,j.lease_token]);return !!r.rowCount;}
  async complete(j:Job,result:unknown,effects?:(tx:Tx)=>Promise<void>,signal?:AbortSignal){
    return this.db.transaction(async tx=>{
      // 锁定输入对象后锁任务，所有结果应用与取消复查在同一事务内。
      const workspace=await tx.query('SELECT version FROM workspaces WHERE id=$1 FOR SHARE',[j.workspace_id]);
      const row=await tx.query("SELECT * FROM jobs WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_until>now() AND cancel_requested=false FOR UPDATE",[j.id,j.lease_token]);
      if(!row.rowCount)return false;
      if(j.input_version!==null&&workspace.rows[0].version!==j.input_version){await tx.query("UPDATE jobs SET state='failed',error_code='STALE_INPUT',finished_at=now(),lease_token=NULL,lease_until=NULL,version=version+1 WHERE id=$1",[j.id]);await this.event(tx,j,'job.failed',{error_code:'STALE_INPUT'});return false;}
      if(signal?.aborted)throw new Error('JOB_TIMEOUT');
      if(effects)await effects(tx);
      if(signal?.aborted)throw new Error('JOB_TIMEOUT');
      await tx.query("UPDATE jobs SET state='succeeded',result=$1,error_code=NULL,finished_at=now(),lease_token=NULL,lease_until=NULL,version=version+1,updated_at=now() WHERE id=$2",[JSON.stringify(result),j.id]);
      await this.event(tx,j,'job.succeeded');return true;
    });
  }
  async fail(j:Job,code:string){
    return this.db.transaction(async tx=>{
      const r=await tx.query(`UPDATE jobs SET state=CASE WHEN attempts<max_attempts AND $1<>'MEDIA_INVALID_FILE' THEN 'queued' ELSE 'failed' END,error_code=$1,
        available_at=now()+LEAST(60,power(2,attempts))::int*interval '1 second',finished_at=CASE WHEN attempts>=max_attempts OR $1='MEDIA_INVALID_FILE' THEN now() ELSE NULL END,
        lease_token=NULL,lease_until=NULL,version=version+1,updated_at=now() WHERE id=$2 AND state='running' AND lease_token=$3 AND lease_until>now() RETURNING state`,[code,j.id,j.lease_token]);
      if(r.rowCount)await this.event(tx,j,r.rows[0].state==='failed'?'job.failed':'job.retry_scheduled',{error_code:code});return r.rowCount;
    });
  }
  async event(tx:Tx,j:Job,action:string,details:unknown={}){await tx.query(`INSERT INTO audit_logs(workspace_id,actor_type,action,object_type,object_id,details,request_id) VALUES($1,'service',$2,'job',$3,$4,$5)`,[j.workspace_id,action,j.id,JSON.stringify(details),j.request_id]);}
  async process(j:Job){
    let lost=false;const timer=setInterval(()=>{void this.heartbeat(j).then(ok=>{if(!ok)lost=true;}).catch(()=>{lost=true;});},config.heartbeatMs);
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),j.timeout_seconds*1000);
    try{
      const work=async()=>{
        const handler=this.handlers[j.type];if(!handler)throw new Error('UNSUPPORTED_JOB');
        const output=await handler(j,controller.signal);let applied=false;try{if(lost)throw new Error('LEASE_LOST');
        if(controller.signal.aborted)throw new Error('JOB_TIMEOUT');
        applied=await this.complete(j,output.result,output.effects,controller.signal);return applied;
        }finally{await output.cleanup?.(applied);}
      };
      const aborted=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('JOB_TIMEOUT')),{once:true}));
      await Promise.race([work(),aborted]);
    }catch(e){const allowed=['UNSUPPORTED_JOB','LEASE_LOST','JOB_TIMEOUT','MEDIA_INVALID_FILE'];const code=allowed.includes((e as Error).message)?(e as Error).message:'JOB_EXECUTION_FAILED';await this.fail(j,code);}
    finally{clearInterval(timer);clearTimeout(timeout);}
  }
  async health(name:string,pool:string){await this.db.query('INSERT INTO process_health(name,pool) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET last_seen_at=now(),pool=EXCLUDED.pool',[name,pool]);}
}
