import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {Database}=require('../../dist/packages/db/src/db.js');
const {Jobs}=require('../../dist/packages/domain/src/jobs.js');
const db=new Database(process.env.TEST_DATABASE_URL);
const job=await new Jobs(db).claim('general');
process.send?.({id:job?.id,lease_token:job?.lease_token});
setInterval(()=>{},1000);
