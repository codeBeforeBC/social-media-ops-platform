import {createHmac} from 'node:crypto';
import {existsSync} from 'node:fs';
import {Request,Response} from 'express';
import {config,idempotencySecret} from '../../../packages/domain/src/config';
import {AppError,equalSecret,secret} from '../../../packages/domain/src/protocol';

const cookieName='yoyo_request';
const lifetime=3600;
const signature=(value:string)=>createHmac('sha256',idempotencySecret()).update('yoyo:local-request:v1:'+value).digest('base64url');

export function localHost(host:string){
  try{const u=new URL('http://'+host);return !u.username&&!u.password&&u.pathname==='/'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&!/[\s@/#?\\]/.test(host);}catch{return false;}
}

export function validateLocalRuntime(){
  const origin=new URL(config.origin);
  if(!localHost(origin.host)||!['http:','https:'].includes(origin.protocol)||origin.origin!==config.origin)throw new Error('Local instance requires a loopback APP_ORIGIN');
  const host=process.env.API_HOST??'127.0.0.1';
  if(!existsSync('/.dockerenv')&&!existsSync('/run/.containerenv')&&!['localhost','127.0.0.1','::1'].includes(host))throw new Error('Native local API must bind to loopback');
}

export class LocalAccess {
  private valid(value:unknown):value is string{
    if(typeof value!=='string')return false;
    const parts=value.split('.');
    return parts.length===3&&/^[\w-]{43}$/.test(parts[0]!)&&/^\d{10}$/.test(parts[1]!)&&Number(parts[1])>Math.floor(Date.now()/1000)&&Number(parts[1])<=Math.floor(Date.now()/1000)+lifetime&&equalSecret(parts[2]!,signature(parts[0]+'.'+parts[1]));
  }
  csrf(req:Request,res:Response){
    if(req.headers.origin&&req.headers.origin!==config.origin)throw new AppError(403,'ORIGIN_REJECTED','请求来源不匹配');
    let value=req.cookies?.[cookieName];
    if(!this.valid(value)){
      const body=secret()+'.'+(Math.floor(Date.now()/1000)+lifetime);value=body+'.'+signature(body);
      res.cookie(cookieName,value,{httpOnly:true,sameSite:'strict',secure:config.secure,path:'/',maxAge:lifetime*1000});
    }
    return {csrf_token:signature('csrf:'+value)};
  }
  checkCsrf(req:Request){
    if(req.headers.origin!==config.origin)throw new AppError(403,'ORIGIN_REJECTED','请求来源不匹配');
    if(!/^application\/(?:json|octet-stream)(?:;|$)/i.test(req.headers['content-type']??''))throw new AppError(415,'CONTENT_TYPE_REJECTED','请求格式不受支持');
    const cookie=req.cookies?.[cookieName],token=req.headers['x-csrf-token'];
    if(!this.valid(cookie)||typeof token!=='string'||!equalSecret(token,signature('csrf:'+cookie)))throw new AppError(403,'CSRF_INVALID','请求凭据已失效，请刷新后重试');
  }
}

export function resRequestId(req:Request):string{return (req as Request&{requestId:string}).requestId;}
