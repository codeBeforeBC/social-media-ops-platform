import {importParseHandler} from '../../../packages/domain/src/imports';
import {Database} from '../../../packages/db/src/db';
import {Jobs} from '../../../packages/domain/src/jobs';
import {config} from '../../../packages/domain/src/config';
import {AITasks} from '../../../packages/domain/src/ai-tasks';
import {Collection} from '../../../packages/domain/src/collection';
import {sourceAdapters} from '../../../packages/domain/src/source-adapters';
import {saveSourceItems} from '../../../packages/domain/src/source-evidence';
import {Storage} from '../../../packages/domain/src/storage';
import {fileValidationHandler} from '../../../packages/domain/src/media';
export async function worker(db:Database,pool=config.workerPool){
  const storage=new Storage();const collection=new Collection(db,sourceAdapters,saveSourceItems);const jobs=new Jobs(db,{'ai.generate':new AITasks(db).handler,'source.collect':collection.handler,'file.validate':fileValidationHandler(db,storage),'import.parse':importParseHandler(db)});let stopping=false;
  const stop=()=>{stopping=true;};process.on('SIGTERM',stop);process.on('SIGINT',stop);
  try{while(!stopping){await jobs.health(`worker:${pool}:${process.pid}`,pool);const j=await jobs.claim(pool);if(j){console.log(JSON.stringify({event:'job.claimed',job_id:j.id,request_id:j.request_id,pool,attempt:j.attempts}));await jobs.process(j);}else await new Promise(r=>setTimeout(r,config.pollMs));}}
  finally{storage.destroy();process.off('SIGTERM',stop);process.off('SIGINT',stop);}
}
if(require.main===module){const db=new Database();worker(db).catch(()=>{console.error(JSON.stringify({event:'worker.failed',error_code:'WORKER_DATABASE_ERROR'}));process.exitCode=1;}).finally(()=>db.close());}
