import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {setupToken} from './config';
function key(){return createHash('sha256').update('yoyo:idempotency:'+setupToken()).digest();}
export function storeResponse(data:any):unknown{
  if(!data?.invitation_token)return data;
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);
  const content=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);
  return {encrypted:true,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),content:content.toString('base64')};
}
export function readResponse(data:any):unknown{
  if(data?.encrypted!==true)return data;
  const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(data.iv,'base64'));decipher.setAuthTag(Buffer.from(data.tag,'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.content,'base64')),decipher.final()]).toString('utf8'));
}
