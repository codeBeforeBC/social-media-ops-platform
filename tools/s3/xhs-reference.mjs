/** Strict public profile inputs; signed note navigation stays inside the collector. */
export function referenceAccountId(value){
 if(typeof value!=='string')throw Object.assign(new Error('INVALID_INPUT'),{code:'INVALID_INPUT'});
 const raw=value.trim();
 if(/^[a-f0-9]{24}$/i.test(raw))return raw.toLowerCase();
 let url;try{url=new URL(raw);}catch{throw Object.assign(new Error('INVALID_INPUT'),{code:'INVALID_INPUT'});}
 const id=url.pathname.match(/^\/user\/profile\/([a-f0-9]{24})\/?$/i)?.[1];
 if(url.protocol!=='https:'||url.hostname!=='www.xiaohongshu.com'||url.port||url.username||url.password||url.search||url.hash||!id)throw Object.assign(new Error('INVALID_INPUT'),{code:'INVALID_INPUT'});
 return id.toLowerCase();
}
export function referenceNoteIdentity(raw,accountId){
 const url=new URL(raw),match=url.pathname.match(/^\/user\/profile\/([a-f0-9]{24})\/([a-f0-9]{24})\/?$/i);
 if(url.protocol!=='https:'||url.hostname!=='www.xiaohongshu.com'||url.port||url.username||url.password||!match||match[1].toLowerCase()!==referenceAccountId(accountId))throw Object.assign(new Error('SOURCE_CHANGED'),{code:'SOURCE_CHANGED'});
 return {id:match[2].toLowerCase(),canonical_url:`https://www.xiaohongshu.com/explore/${match[2].toLowerCase()}`};
}
