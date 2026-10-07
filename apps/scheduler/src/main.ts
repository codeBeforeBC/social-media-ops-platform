import {Database} from '../../../packages/db/src/db';
import {Jobs} from '../../../packages/domain/src/jobs';
export async function scheduler(db:Database){
  const jobs=new Jobs(db);let stopping=false;const stop=()=>{stopping=true;};process.on('SIGTERM',stop);process.on('SIGINT',stop);
  try{while(!stopping){await jobs.health(`scheduler:${process.pid}`,'scheduler');await jobs.dispatch();await new Promise(r=>setTimeout(r,1000));}}
  finally{process.off('SIGTERM',stop);process.off('SIGINT',stop);}
}
if(require.main===module){const db=new Database();scheduler(db).catch(()=>{console.error(JSON.stringify({event:'scheduler.failed',error_code:'SCHEDULER_DATABASE_ERROR'}));process.exitCode=1;}).finally(()=>db.close());}
