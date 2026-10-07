let csrf='';
export class ApiError extends Error {constructor(public code:string,message:string,public requestId:string,public status:number){super(message);}}
export async function api<T=any>(path:string,options:{method?:string;body?:unknown;key?:string}={}):Promise<T>{
  const method=options.method??'GET';
  if(method!=='GET'&&!csrf){const r=await api<{csrf_token:string}>('/auth/csrf');csrf=r.csrf_token;}
  const res=await fetch('/api/v1'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(method!=='GET'?{'X-CSRF-Token':csrf,'Idempotency-Key':options.key??crypto.randomUUID()}:{})},...(method!=='GET'?{body:JSON.stringify(options.body??{})}:{})});
  const envelope=await res.json();
  if(!res.ok){if(envelope.error?.code==='CSRF_INVALID'||res.status===401)csrf='';if(res.status===401&&path!=='/auth/login')window.dispatchEvent(new Event('session-expired'));throw new ApiError(envelope.error?.code??'NETWORK_ERROR',envelope.error?.message??'请求失败',envelope.error?.request_id??'',res.status);}
  if(envelope.data?.csrf_token)csrf=envelope.data.csrf_token;
  if(path==='/auth/logout')csrf='';return envelope.data;
}
