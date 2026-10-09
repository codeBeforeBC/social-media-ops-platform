/** Isolated Compose smoke project, config over stdin, secret cleaned before exit. */
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const project='yoyo-s3-ai-smoke',report={checked_at:new Date().toISOString(),project,actual_model_calls:false,checks:[]};
function run(args,input){const r=spawnSync('docker',['compose','-p',project,...args],{input,encoding:'utf8',env:{...process.env,YOYO_PORT:'59040',S3_PORT:'59041',S3_PUBLIC_ENDPOINT:'http://localhost:59041',APP_ORIGIN:'http://localhost:59040'}});if(r.status!==0)throw new Error('COMPOSE_COMMAND_FAILED');return r.stdout.trim();}
const cli=(mode)=>run(['exec','-T','worker','node','dist/tools/ai-config.js',mode]);
try{
 const config=JSON.parse(readFileSync('.local/ai/deepseek.json','utf8'));config.enabled=false;
 const saved=JSON.parse(run(['exec','-T','worker','node','dist/tools/ai-config.js','set'],JSON.stringify(config)));report.checks.push({name:'stdin_config_saved_disabled',passed:saved.saved&&saved.enabled===false});
 const status=JSON.parse(cli('status'));report.checks.push({name:'worker_loads_state_path',passed:status.configured&&status.model===config.model&&status.enabled===false});
 const permissions=JSON.parse(run(['exec','-T','worker','node','-e',"const fs=require('fs');console.log(JSON.stringify({path:process.env.AI_CONFIG_FILE,mode:fs.statSync(process.env.AI_CONFIG_FILE).mode&511}))"]));report.checks.push({name:'state_path_and_0600',passed:permissions.path==='/state/ai.json'&&permissions.mode===384});
 run(['restart','worker']);const restarted=JSON.parse(cli('status'));report.checks.push({name:'config_survives_worker_restart',passed:restarted.configured&&restarted.enabled===false});
 const api=JSON.parse(run(['exec','-T','api','node','dist/tools/ai-config.js','status']));report.checks.push({name:'shared_instance_config',passed:api.configured&&api.enabled===false});
 report.checks.push({name:'no_automatic_AI_jobs',passed:JSON.parse(run(['exec','-T','worker','node','-e',"const {Database}=require('./dist/packages/db/src/db.js');const {databaseUrl}=require('./dist/packages/domain/src/config.js');(async()=>{const db=new Database(databaseUrl());const r=await db.query('SELECT count(*)::int n FROM ai_requests');console.log(JSON.stringify({count:r.rows[0].n}));await db.close()})().catch(()=>process.exit(1))"])).count===0});
}catch{report.error_code='COMPOSE_AI_CONFIG_VERIFICATION_FAILED';process.exitCode=1;}
finally{
 try{run(['exec','-T','worker','node','-e',"require('fs').unlinkSync(process.env.AI_CONFIG_FILE)"]);report.secret_cleanup=true;}catch{report.secret_cleanup=false;process.exitCode=1;}
 report.finished_at=new Date().toISOString();report.passed=!report.error_code&&report.secret_cleanup&&report.checks.every(c=>c.passed);writeFileSync('docs/evidence/s3/compose-ai-config-check.json',JSON.stringify(report,null,2)+'\n');if(!report.passed)process.exitCode=1;
}
