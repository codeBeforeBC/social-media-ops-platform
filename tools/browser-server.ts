import {createApp} from '../apps/api/src/main';
import {Jobs} from '../packages/domain/src/jobs';
import {Storage} from '../packages/domain/src/storage';
import {mediaHandler} from '../packages/domain/src/media';
import {exportHandler} from '../packages/domain/src/export-package';
import {database,reset} from '../tests/helpers';
async function main(){const db=await database();await reset(db);const app=await createApp(db);await app.listen(3001,'127.0.0.1');const storage=new Storage();await storage.init();const jobs=new Jobs(db,{'media.preview':mediaHandler(db,storage),'content.export':exportHandler(db,storage)});let busy=false;const timer=setInterval(async()=>{if(busy)return;busy=true;try{await jobs.dispatch();const j=await jobs.claim('media');if(j)await jobs.process(j);const general=await jobs.claim('general');if(general)await jobs.process(general);}catch{}finally{busy=false;}},250);const stop=async()=>{clearInterval(timer);await app.close();storage.destroy();await db.close();};process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());}
main().catch(()=>{console.error('Browser test server failed');process.exit(1);});
