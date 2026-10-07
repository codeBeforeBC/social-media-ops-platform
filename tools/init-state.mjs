import {mkdirSync,existsSync,readFileSync,writeFileSync,chmodSync,chownSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
const dir=process.env.STATE_DIR??'.local/state';
mkdirSync(dir,{recursive:true,mode:0o700});
const path=join(dir,'instance.json');
if(!existsSync(path)){
  const data={database_password:randomBytes(32).toString('hex'),setup_token:randomBytes(32).toString('base64url')};
  writeFileSync(path,JSON.stringify(data),{flag:'wx',mode:0o600});
}
const data=JSON.parse(readFileSync(path,'utf8'));
const passwordPath=join(dir,'postgres-password');
writeFileSync(passwordPath,data.database_password,{mode:0o600});
chmodSync(path,0o600);chmodSync(passwordPath,0o600);
if(process.getuid?.()===0){chownSync(dir,1000,1000);chownSync(path,1000,1000);}
console.log('Instance credentials ready; no secrets printed.');
