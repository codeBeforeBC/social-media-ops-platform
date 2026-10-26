/** Transport only for historical login-based release probes (rc15 and earlier). */
import {randomUUID} from 'node:crypto';
export class Client {
 cookie='';csrf='';constructor(readonly base:string){}
 async call(path:string,method='GET',body?:unknown,headers:Record<string,string>={}){
  const r=await fetch(this.base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,...(method!=='GET'?{Origin:this.base,'X-CSRF-Token':this.csrf,'Idempotency-Key':randomUUID()}:{}),...headers},...(method!=='GET'?{body:JSON.stringify(body??{})}:{})});
  const set=r.headers.get('set-cookie');if(set)this.cookie=set.split(';')[0]!;
  const json=await r.json();if(json.data?.csrf_token)this.csrf=json.data.csrf_token;return {status:r.status,data:json.data,error:json.error,headers:r.headers,meta:json.meta};
 }
 async init(){return this.call('/auth/csrf');}
 async login(email:string,password:string){await this.init();return this.call('/auth/login','POST',{email,password});}
}
