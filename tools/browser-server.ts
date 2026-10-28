import {createServer} from 'node:http';
import {AccountVerificationTasks} from '../packages/domain/src/account-verifications';
import {writeFileSync} from 'node:fs';
import {SourceOrganizationTasks} from '../packages/domain/src/source-organization';
import {sourceOrganizationResponse} from '../tests/source-organization-fixtures';
import {FeedbackTasks} from '../packages/domain/src/feedback';
import {feedbackResponse} from '../tests/feedback-fixtures';
import {ReportTasks} from '../packages/domain/src/reports';
import {AIGateway} from '../packages/domain/src/ai-gateway';
import {reportTestConfig,reportTestResponse} from '../tests/report-fixtures';
import {importParseHandler} from '../packages/domain/src/imports';
import {createApp} from '../apps/api/src/main';
import {Jobs} from '../packages/domain/src/jobs';
import {Storage} from '../packages/domain/src/storage';
import {fileValidationHandler} from '../packages/domain/src/media';
import {database,reset} from '../tests/helpers';
async function main(){
// Explicit controlled identity adapter for browser tests; never uses a real platform session.
const attempts=new Map<string,number>();const bridge=createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');
 if(req.url==='/profiles'){res.end(JSON.stringify({ok:true,items:[{id:'browser-profile'},{id:'other-browser-profile'}]}));return;}
 if(req.url!=='/accounts/verify'){res.statusCode=404;res.end('{}');return;}
 let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw),target=input.target_id,count=(attempts.get(target)??0)+1;attempts.set(target,count);
 await new Promise(r=>setTimeout(r,1000));const auth=target.endsWith('ee')&&count===1,mismatch=target.endsWith('dd');
 res.end(JSON.stringify({ok:true,result:{public_status:auth?'inconclusive':'matched',session_status:auth?'auth_required':mismatch?'mismatched':'matched',public_profile:auth?null:{id:target,nickname:'明确合成平台昵称',display_handle:'明确合成展示号'},session_id:auth?null:mismatch?'111111111111111111111111':target,observed_at:new Date().toISOString(),adapter_version:'controlled-browser-identity-not-real',capabilities:{public_identity:auth?'unknown':'supported',current_session_identity:auth?'unknown':'supported',own_account_metrics:'unknown'},error_code:auth?'AUTH_REQUIRED':mismatch?'ACCOUNT_MISMATCH':null}}));
});await new Promise<void>(r=>bridge.listen(0,'127.0.0.1',r));process.env.SOURCE_BRIDGE_URL='http://127.0.0.1:'+(bridge.address() as any).port;process.env.SOURCE_BRIDGE_TOKEN='synthetic-browser-bridge-token-only';
const db=await database();await reset(db);const fixturePath=(process.env.STATE_DIR??'.local/state')+'/browser-ai.json';writeFileSync(fixturePath,JSON.stringify(reportTestConfig),{mode:0o600});process.env.AI_CONFIG_FILE=fixturePath;const app=await createApp(db);await app.listen(3001,'127.0.0.1');const storage=new Storage();await storage.init();const reportTasks=new ReportTasks(db,()=>new AIGateway(db,reportTestConfig,async messages=>({content:JSON.stringify(reportTestResponse(JSON.parse(messages[1]!.content))),usage:{input_tokens:10,output_tokens:20,total_tokens:30}})));const jobs=new Jobs(db,{'account.verify':new AccountVerificationTasks(db).handler,'report.generate':reportTasks.handler,'source.organize':new SourceOrganizationTasks(db,()=>new AIGateway(db,reportTestConfig,async m=>({content:JSON.stringify(sourceOrganizationResponse(JSON.parse(m[1]!.content))),usage:{input_tokens:10,output_tokens:20,total_tokens:30}}))).handler,'feedback.organize':new FeedbackTasks(db,()=>new AIGateway(db,reportTestConfig,async messages=>({content:JSON.stringify(feedbackResponse(JSON.parse(messages[1]!.content))),usage:{input_tokens:10,output_tokens:20,total_tokens:30}}))).handler,'file.validate':fileValidationHandler(db,storage),'import.parse':importParseHandler(db)});let busy=false;const timer=setInterval(async()=>{if(busy)return;busy=true;try{await jobs.dispatch();const j=await jobs.claim('media');if(j)await jobs.process(j);const general=await jobs.claim('general');if(general)await jobs.process(general);}catch{}finally{busy=false;}},250);const stop=async()=>{clearInterval(timer);await app.close();storage.destroy();await db.close();await new Promise<void>(r=>bridge.close(()=>r()));};process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());}
main().catch(()=>{console.error('Browser test server failed');process.exit(1);});
