let csrf='';
export class ApiError extends Error {constructor(public code:string,message:string,public requestId:string,public status:number,public fields:Record<string,unknown>={}){super(message);}}
export async function api<T=any>(path:string,options:{method?:string;body?:unknown;key?:string}={}):Promise<T>{
  const method=options.method??'GET';
  if(method!=='GET'&&!csrf){const r=await api<{csrf_token:string}>('/request/csrf');csrf=r.csrf_token;}
  const res=await fetch('/api/v1'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(method!=='GET'?{'X-CSRF-Token':csrf,'Idempotency-Key':options.key??crypto.randomUUID()}:{})},...(method!=='GET'?{body:JSON.stringify(options.body??{})}:{})});
  const envelope=await res.json();
  if(!res.ok){if(envelope.error?.code==='CSRF_INVALID')csrf='';throw new ApiError(envelope.error?.code??'NETWORK_ERROR',envelope.error?.message??'请求失败',envelope.error?.request_id??'',res.status,envelope.error?.field_errors??{});}
  if(envelope.data?.csrf_token)csrf=envelope.data.csrf_token;
  return envelope.data;
}

export async function uploadPart(url:string,body:Blob,signal?:AbortSignal){
  if(!csrf)await api('/request/csrf');const r=await fetch(url,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream','X-CSRF-Token':csrf},body,signal});
  const envelope=await r.json();if(!r.ok)throw new ApiError(envelope.error?.code??'UPLOAD_FAILED',envelope.error?.message??'分片上传失败',envelope.error?.request_id??'',r.status);return envelope.data;
}
