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
async function main(){const db=await database();await reset(db);const fixturePath=(process.env.STATE_DIR??'.local/state')+'/browser-ai.json';writeFileSync(fixturePath,JSON.stringify(reportTestConfig),{mode:0o600});process.env.AI_CONFIG_FILE=fixturePath;const app=await createApp(db);await app.listen(3001,'127.0.0.1');const storage=new Storage();await storage.init();const reportTasks=new ReportTasks(db,()=>new AIGateway(db,reportTestConfig,async messages=>({content:JSON.stringify(reportTestResponse(JSON.parse(messages[1]!.content))),usage:{input_tokens:10,output_tokens:20,total_tokens:30}})));const jobs=new Jobs(db,{'report.generate':reportTasks.handler,'source.organize':new SourceOrganizationTasks(db,()=>new AIGateway(db,reportTestConfig,async m=>({content:JSON.stringify(sourceOrganizationResponse(JSON.parse(m[1]!.content))),usage:{input_tokens:10,output_tokens:20,total_tokens:30}}))).handler,'feedback.organize':new FeedbackTasks(db,()=>new AIGateway(db,reportTestConfig,async messages=>({content:JSON.stringify(feedbackResponse(JSON.parse(messages[1]!.content))),usage:{input_tokens:10,output_tokens:20,total_tokens:30}}))).handler,'file.validate':fileValidationHandler(db,storage),'import.parse':importParseHandler(db)});let busy=false;const timer=setInterval(async()=>{if(busy)return;busy=true;try{await jobs.dispatch();const j=await jobs.claim('media');if(j)await jobs.process(j);const general=await jobs.claim('general');if(general)await jobs.process(general);}catch{}finally{busy=false;}},250);const stop=async()=>{clearInterval(timer);await app.close();storage.destroy();await db.close();};process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());}
main().catch(()=>{console.error('Browser test server failed');process.exit(1);});
