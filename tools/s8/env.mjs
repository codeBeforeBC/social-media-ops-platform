import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import pg from 'pg';
const c=JSON.parse(readFileSync('.local/state/instance.json','utf8'));
const connection={host:'127.0.0.1',port:54329,user:'yoyo',password:c.database_password};
const db=new pg.Client({...connection,database:'postgres'});await db.connect();
const testName=process.env.S8_AI_EVALUATION==='1'?'yoyo_s8_ai_test':'yoyo_s8_test';
for(const name of ['yoyo_s8_dev',testName])if(!(await db.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)await db.query('CREATE DATABASE '+name);
await db.end();
for(const name of ['yoyo','yoyo_test']){const d=new pg.Client({...connection,database:name});await d.connect();console.log(JSON.stringify({database:name,migrations:(await d.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n}));await d.end();}
const args=process.argv.slice(2);const url=`postgresql://yoyo:${c.database_password}@127.0.0.1:54329/`;
const child=spawn(args[0]??'pnpm',args.length?args.slice(1):['test'],{stdio:'inherit',env:{...process.env,DATABASE_URL:url+'yoyo_s8_dev',TEST_DATABASE_URL:url+testName,ALLOW_TEST_RESET:testName}});child.on('exit',code=>process.exitCode=code??1);
