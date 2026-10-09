import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {z} from 'zod';
import {Collector,CollectionResult,SourceFailure} from './collection';
import {sha} from './protocol';
const timestamp=z.string().datetime({offset:true});
const count=z.object({raw:z.string().nullable(),value:z.number().finite().nonnegative().nullable(),approximate:z.boolean()}).strict();
export const sourceItem=z.object({external_id:z.string().min(1).max(200),canonical_url:z.string().url().refine(u=>{const p=new URL(u);return p.protocol==='https:'&&['www.xiaohongshu.com','s.weibo.com','weibo.com'].includes(p.hostname)&&!p.username&&!p.password&&!p.searchParams.has('xsec_token');}),title:z.string().min(1).max(1000),summary:z.string().max(10000),author:z.string().max(500).nullable(),published_at:timestamp.nullable(),date_label_raw:z.string().max(200).nullable(),captured_at:timestamp,actual_source_type:z.enum(['official_rank','search','topic','curated_feed','account_feed']),keyword:z.string().max(200).optional(),media_type:z.enum(['image','video','unknown']),visible_counts:z.record(z.string(),count),rank:z.number().int().nonnegative().nullable(),reference_only:z.literal(true),has_live_photo:z.boolean().optional(),body_sha256:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
export function validateSourceResult(raw:unknown):CollectionResult{
 const s=z.object({items:z.array(sourceItem).max(50),coverage:z.record(z.string(),z.unknown()),warnings:z.array(z.string().max(200)).max(50).optional(),capabilities:z.object({list_items:z.boolean().nullable(),read_detail:z.boolean().nullable(),read_comments:z.boolean().nullable(),historical_metrics:z.boolean().nullable(),own_account_metrics:z.boolean().nullable()}).strict().optional(),adapter_version:z.string().max(200),captured_at:timestamp.optional(),next_cursor:z.string().max(2000).nullable().optional(),quota_state:z.object({provider_limit_known:z.boolean(),provider_remaining:z.number().int().nonnegative().nullable(),request_item_limit:z.number().int().min(1).max(50)}).strict().optional()}).strict().safeParse(raw);
 if(!s.success)throw new SourceFailure('SOURCE_CHANGED',{stage:'result_schema',issues:s.error.issues.map(i=>({path:i.path.join('.'),code:i.code}))});return s.data;
}
async function boundedJson(response:Response,signal:AbortSignal){
 if(!response.body)throw new SourceFailure('PARSE_FAILED');const reader=response.body.getReader();const chunks:Uint8Array[]=[];let length=0;
 try{for(;;){if(signal.aborted)throw new SourceFailure('TIMEOUT');const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2000000)throw new SourceFailure('PARSE_FAILED');chunks.push(value);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw new SourceFailure('PARSE_FAILED');}}
 finally{await reader.cancel().catch(()=>{});}
}
export const weiboCollector:Collector=async(c,signal)=>{
 const requestSignal=AbortSignal.any([signal,AbortSignal.timeout(20000)]);let response:Response;
 try{response=await fetch('https://weibo.com/ajax/statuses/hot_band',{signal:requestSignal,redirect:'error',headers:{'User-Agent':'Mozilla/5.0','Referer':'https://weibo.com/','Accept':'application/json'}});}catch{throw new SourceFailure(requestSignal.aborted?'TIMEOUT':'SOURCE_UNAVAILABLE');}
 if(response.status===401)throw new SourceFailure('AUTH_REQUIRED');if(response.status===403)throw new SourceFailure('ACCESS_DENIED');if(response.status===429)throw new SourceFailure('RATE_LIMITED');if(!response.ok)throw new SourceFailure('SOURCE_UNAVAILABLE');
 const data=await boundedJson(response,requestSignal);if(data?.ok!==1||!Array.isArray(data.data?.band_list))throw new SourceFailure('SOURCE_CHANGED',{stage:'weibo_payload',ok_type:typeof data?.ok,list_type:typeof data?.data?.band_list});
 const rows=data.data.band_list;if(!rows.length)throw new SourceFailure('EMPTY_RESULT');if(rows.length>1000)throw new SourceFailure('SOURCE_CHANGED',{stage:'weibo_list_size',list_size:rows.length});
 const captured=new Date().toISOString();const items=rows.slice(0,c.config.max_items??50).map((r:any)=>{
  if(typeof r.word!=='string'||!r.word.trim()||[r.realpos,r.num,r.onboard_time].some(x=>x!==undefined&&x!==null&&(!Number.isInteger(x)||x<0)))throw new SourceFailure('SOURCE_CHANGED',{stage:'weibo_item',word_type:typeof r.word,numeric_types:[r.realpos,r.num,r.onboard_time].map(x=>typeof x)});
  return {external_id:sha(r.word),canonical_url:'https://s.weibo.com/weibo?q='+encodeURIComponent(r.word),title:r.word,summary:'',author:null,published_at:null,date_label_raw:null,captured_at:captured,actual_source_type:'official_rank',media_type:'unknown',visible_counts:r.num==null?{}:{heat:{raw:String(r.num),value:r.num,approximate:false}},rank:r.realpos??null,reference_only:true};
 });
 return validateSourceResult({items,captured_at:captured,next_cursor:null,quota_state:{provider_limit_known:false,provider_remaining:null,request_item_limit:c.config.max_items??50},coverage:{actual_source_type:'official_rank',endpoint:'hot_band',source_list_size:rows.length,returned_items:items.length,auth:'anonymous',published_time_available:false},warnings:[],capabilities:{list_items:true,read_detail:false,read_comments:false,historical_metrics:false,own_account_metrics:false},adapter_version:'weibo-web-v1'});
};
export const xhsCollector:Collector=async(c,signal)=>{
 const payload={source_type:c.source_type,config:c.config};let response:any;
 if(process.env.SOURCE_BRIDGE_URL){
  const base=new URL(process.env.SOURCE_BRIDGE_URL);if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw new SourceFailure('ADAPTER_UNAVAILABLE');
  const token=process.env.SOURCE_BRIDGE_TOKEN??(process.env.SOURCE_BRIDGE_TOKEN_FILE?readFileSync(process.env.SOURCE_BRIDGE_TOKEN_FILE,'utf8').trim():'');if(!token)throw new SourceFailure('ADAPTER_UNAVAILABLE');
  try{const r=await fetch(new URL('/collect',base),{method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(90000)]),headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(payload)});if(!r.ok)throw new SourceFailure(r.status===409?'BROWSER_BUSY':'BROWSER_UNAVAILABLE');response=await boundedJson(r,signal);}catch(e){if(e instanceof SourceFailure)throw e;throw new SourceFailure(signal.aborted?'TIMEOUT':'BROWSER_UNAVAILABLE');}
 }else{
  response=await new Promise((accept,reject)=>{
   const child=execFile(process.execPath,[resolve('tools/s3/xhs-collector.mjs')],{signal,timeout:90000,maxBuffer:2000000},(error,stdout)=>{if(error)return reject(new SourceFailure(signal.aborted?'TIMEOUT':'BROWSER_UNAVAILABLE'));try{accept(JSON.parse(stdout));}catch{reject(new SourceFailure('PARSE_FAILED'));}});child.stdin?.end(JSON.stringify(payload));
  });
 }
 if(!response?.ok)throw new SourceFailure(response?.error_code??'BROWSER_UNAVAILABLE');return validateSourceResult(response.result);
};
export const sourceAdapters={weibo_hot:weiboCollector,xhs_topic_signal:xhsCollector,xhs_quality_note:xhsCollector};
