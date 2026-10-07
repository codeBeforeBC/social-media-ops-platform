import {createApp} from '../apps/api/src/main';
import {database,reset} from '../tests/helpers';
async function main(){const db=await database();await reset(db);const app=await createApp(db);await app.listen(3001,'127.0.0.1');const stop=async()=>{await app.close();await db.close();};process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());}
main().catch(()=>{console.error('Browser test server failed');process.exit(1);});
