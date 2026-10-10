import {createHash,randomBytes,timingSafeEqual,randomUUID} from 'node:crypto';
import {z} from 'zod';
export class AppError extends Error {
  constructor(public status:number,public code:string,message:string,public fields:unknown={},public retryable=false){super(message);}
}
export const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
export const secret=()=>randomBytes(32).toString('base64url');
export const id=()=>randomUUID();
export function equalSecret(a:string,b:string){return timingSafeEqual(Buffer.from(sha(a)),Buffer.from(sha(b)));}
export function canonical(value:unknown):string{
  if(value instanceof Date)return JSON.stringify(value.toJSON());
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
}
export function parse<T>(schema:z.ZodType<T>,value:unknown):T{
  const r=schema.safeParse(value);if(!r.success)throw new AppError(422,'VALIDATION_ERROR','请检查输入字段',r.error.flatten());return r.data;
}
export const text=(max=200)=>z.string().trim().min(1).max(max).refine(s=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s),'含非法控制字符');
export const uuid=z.string().uuid();
export const roles=z.array(z.enum(['admin','editor','operator','viewer'])).min(1).max(4).refine(a=>new Set(a).size===a.length);
export const timezone=text().refine(t=>{try{new Intl.DateTimeFormat('zh-CN',{timeZone:t});return true;}catch{return false;}},'无效IANA时区');
export const version=z.number().int().positive();
export type Role=z.infer<typeof roles>[number];
export type Actor={userId:string;memberId:string;workspaceId:string;roles:Role[];sessionHash:string;requestId:string};
export type Permission='read'|'admin'|'account.edit'|'download.original'|'topic.edit'|'import.edit'|'operate'|'job.manage';
const grants:Record<Permission,Role[]>={read:['admin','editor','operator','viewer'],admin:['admin'],'account.edit':['admin','operator'],'download.original':['admin','operator'],'topic.edit':['admin','editor','operator'],'import.edit':['admin','operator'],operate:['admin','operator'],'job.manage':['admin','editor','operator']};
export function authorize(actor:Actor,permission:Permission){if(!actor.roles.some(r=>grants[permission].includes(r)))throw new AppError(403,'FORBIDDEN','当前角色没有此操作权限');}
export function permissions(actor:Actor){return Object.keys(grants).filter(p=>actor.roles.some(r=>grants[p as Permission].includes(r)));}
export function pagination(query:Record<string,unknown>){
  const n=query.limit===undefined?20:Number(query.limit);if(!Number.isInteger(n)||n<1||n>100)throw new AppError(422,'INVALID_LIMIT','每页数量应为1–100');
  let cursor:{at:string;id:string}|null=null;
  if(query.cursor){try{cursor=parse(z.object({at:z.iso.datetime({offset:true}),id:uuid}).strict(),JSON.parse(Buffer.from(String(query.cursor),'base64url').toString()));}catch{throw new AppError(422,'INVALID_CURSOR','分页游标无效');}}
  if(query.sort!==undefined&&query.sort!=='created_at:desc')throw new AppError(422,'INVALID_SORT','仅支持created_at:desc');
  return {limit:n,cursor};
}
export function page(rows:Record<string,any>[],limit:number,at='created_at'){
  const items=rows.slice(0,limit);const last=items.at(-1);
  return {items,next_cursor:rows.length>limit&&last?Buffer.from(JSON.stringify({at:new Date(last[at]).toISOString(),id:last.id})).toString('base64url'):null};
}
