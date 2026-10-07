import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
try {process.loadEnvFile('.env');} catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
const stateDir=resolve(process.env.STATE_DIR??'.local/state');
export function credentials(): {database_password:string;setup_token:string} {
  return JSON.parse(readFileSync(resolve(stateDir,'instance.json'),'utf8'));
}
export function databaseUrl(test=false):string {
  if(test){
    const url=process.env.TEST_DATABASE_URL;
    if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Tests require a dedicated *_test database');
    return url;
  }
  return process.env.DATABASE_URL??`postgresql://yoyo:${credentials().database_password}@${process.env.DB_HOST??'127.0.0.1'}:${process.env.DB_PORT??'54329'}/yoyo`;
}
export const config={
  origin:process.env.APP_ORIGIN??'http://localhost:3000',port:Number(process.env.PORT??3000),
  stateDir,secure:process.env.NODE_ENV==='production',
  absoluteSeconds:Number(process.env.SESSION_ABSOLUTE_SECONDS??43200),idleSeconds:Number(process.env.SESSION_IDLE_SECONDS??7200),
  leaseSeconds:Number(process.env.JOB_LEASE_SECONDS??30),heartbeatMs:Number(process.env.JOB_HEARTBEAT_MS??5000),
  pollMs:Number(process.env.JOB_POLL_MS??1000),workerPool:process.env.WORKER_POOL??'general'
};
if(!Number.isFinite(config.leaseSeconds)||config.leaseSeconds<1||config.heartbeatMs>=config.leaseSeconds*1000)throw new Error('Invalid job lease / heartbeat configuration');
export function setupToken(){if(!existsSync(resolve(stateDir,'instance.json')))throw new Error('Run instance initialization first');return credentials().setup_token;}
