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
if(!data.media_token){data.media_token=randomBytes(32).toString('hex');writeFileSync(path,JSON.stringify(data),{mode:0o600});}
mkdirSync(join(dir,'media'),{recursive:true,mode:0o700});writeFileSync(join(dir,'media','media-token'),data.media_token,{mode:0o600});
if(!data.storage_access_key||!data.storage_secret_key){data.storage_access_key='yoyo-'+randomBytes(8).toString('hex');data.storage_secret_key=randomBytes(32).toString('hex');writeFileSync(path,JSON.stringify(data),{mode:0o600});}
for(const [name,value] of [['storage-access-key',data.storage_access_key],['storage-secret-key',data.storage_secret_key]]){const f=join(dir,name);writeFileSync(f,value,{mode:0o600});chmodSync(f,0o600);}
writeFileSync(join(dir,'storage-config.json'),JSON.stringify({identities:[{name:'yoyo',credentials:[{accessKey:data.storage_access_key,secretKey:data.storage_secret_key}],actions:['Admin','Read','Write','List','Tagging']}]}),{mode:0o600});
const passwordPath=join(dir,'postgres-password');
writeFileSync(passwordPath,data.database_password,{mode:0o600});
chmodSync(path,0o600);chmodSync(passwordPath,0o600);
if(process.getuid?.()===0){chownSync(dir,1000,1000);chownSync(join(dir,"media"),1000,1000);chownSync(join(dir,"media","media-token"),1000,1000);chownSync(path,1000,1000);for(const name of ["storage-access-key","storage-secret-key","storage-config.json"])chownSync(join(dir,name),1000,1000);}
console.log('Instance credentials ready; no secrets printed.');
