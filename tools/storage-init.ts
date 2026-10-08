import {Storage} from '../packages/domain/src/storage';
const store=new Storage();store.init().then(()=>console.log('Private storage ready.')).catch(()=>{console.error('Storage initialization failed; inspect endpoint/credentials.');process.exitCode=1;}).finally(()=>store.destroy());
