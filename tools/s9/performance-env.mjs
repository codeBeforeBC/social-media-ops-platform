import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import pg from 'pg';
const c=JSON.parse(readFileSync('.local/state/instance.json','utf8')),name='yoyo_s9_performance_test';
const db=new pg.Client({host:'127.0.0.1',port:54329,user:'yoyo',password:c.database_password,database:'postgres'});await db.connect();
if(!(await db.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)await db.query('CREATE DATABASE '+name);await db.end();
const env={...process.env,TEST_DATABASE_URL:`postgresql://yoyo:${c.database_password}@127.0.0.1:54329/${name}`,ALLOW_TEST_RESET:name,STATE_DIR:'.local/s9-performance-state',NODE_ENV:'test'};
async function run(command,args){await new Promise((resolve,reject)=>{const p=spawn(command,args,{env,stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(command+' failed')));});}
await run('node',['tools/init-state.mjs']);await run('pnpm',['exec','tsx','tools/s9/performance.ts']);
