/** Bounded public search/detail adapter. Signed navigation URLs never leave this process. */
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {prepareSearch} from '../s0/prepare-opencli-xhs.mjs';
import {noteIdentity,normalizeDetail,normalizeCount,prepareNavigation} from '../s0/probe-xhs-navigation.mjs';
import {referenceAccountId,referenceNoteIdentity} from './xhs-reference.mjs';
import {classifyDetailMedia} from '../s0/xhs-detail-media.mjs';
export async function collectXhs(input){
 const root=resolve(process.env.OPENCLI_ROOT??'.local/providers/opencli/node_modules/@jackwener/opencli');
 const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
 if(pkg.name!=='@jackwener/opencli'||pkg.version!=='1.8.8')throw Object.assign(new Error('DEPENDENCY_CHANGED'),{code:'DEPENDENCY_CHANGED'});
 const searchFile=join(root,'clis/xiaohongshu/search.js');const source=await readFile(searchFile,'utf8');
 if(prepareSearch(source).changed)throw Object.assign(new Error('DEPENDENCY_CHANGED'),{code:'DEPENDENCY_CHANGED'});
 if(!['xhs_topic_signal','xhs_quality_note'].includes(input.source_type))throw Object.assign(new Error('INVALID_INPUT'),{code:'INVALID_INPUT'});
 const keywords=input.config?.keywords??['旅行','IP','潮玩','情绪价值'];
 if(!Array.isArray(keywords)||!keywords.length||keywords.length>10||keywords.some(k=>typeof k!=='string'||!k.trim()||k.length>100))throw Object.assign(new Error('INVALID_INPUT'),{code:'INVALID_INPUT'});
 const maximum=Math.min(50,Math.max(1,input.config?.max_items??9));
 const accounts=(input.config?.reference_accounts??[]).map(referenceAccountId);
 if(accounts.length>2||new Set(accounts).size!==accounts.length||accounts.length&&input.source_type!=='xhs_quality_note')throw Object.assign(new Error('INVALID_INPUT'),{code:'INVALID_INPUT'});
 const perKeyword=Math.min(5,Math.max(1,Math.floor(maximum/(keywords.length+accounts.length))));
 const keywordMaximum=accounts.length?Math.max(0,maximum-accounts.length*perKeyword):maximum;
 const profile=input.config?.profile;
 if(typeof profile!=='string'||!profile||profile.length>100)throw Object.assign(new Error('PROFILE_REQUIRED'),{code:'PROFILE_REQUIRED'});
 const {Page}=await import(pathToFileURL(join(root,'dist/src/browser/page.js')).href);
 const {command:search}=await import(pathToFileURL(searchFile).href);
 const {NOTE_EXTRACT_JS}=await import(pathToFileURL(join(root,'clis/xiaohongshu/note.js')).href);
 const page=new Page(`yoyo-source:${randomUUID()}`,60,profile,'background','adapter','ephemeral');
 const items=new Map(),warnings=[],details=[],accountResults=[],completedKeywords=[],detailFailures=[];
 async function readDetail(row,identity){
  await page.goto(row.url);
  const code=`(async()=>{let previous='',stable=0,result;const deadline=Date.now()+12000;while(Date.now()<deadline){const d=${NOTE_EXTRACT_JS};const panel=document.querySelector('#noteContainer');d.hasDetailPanel=Boolean(panel);d.dateLabel=panel?.querySelector('.date')?.textContent?.trim()||null;const media=(${classifyDetailMedia.toString()})(panel);d.mediaType=media.type;d.hasLivePhoto=media.has_live_photo;if(d.securityBlock||d.loginWall||d.notFound)return {...d,loaded:false};const value=JSON.stringify([d.pageUrl,d.title,d.desc,d.author,d.likes,d.collects,d.comments,d.dateLabel,d.mediaType]);stable=value===previous?stable+1:0;previous=value;result=d;if(panel&&d.author&&d.mediaType!=='unknown'&&stable>=2)return {...d,loaded:true};await new Promise(r=>setTimeout(r,400));}return {...result,loaded:false};})()`;
  const raw=await page.evaluate(code);const normalized=normalizeDetail(raw,identity.id);
  return {title:raw.title||null,summary:String(raw.desc??'').slice(0,10000),author:typeof raw.author==='string'?raw.author:null,date_label_raw:normalized.date_label_raw,media_type:normalized.media_type,visible_counts:normalized.visible_counts,has_live_photo:normalized.has_live_photo,body_sha256:normalized.body_sha256};
 }
 try{
  await prepareNavigation(page);
  for(const keyword of keywords){
   if(items.size>=keywordMaximum)break;
   const rows=await search.func(page,{query:keyword,limit:perKeyword,sort:input.source_type==='xhs_topic_signal'?'latest':'comprehensive','note-type':'all','publish-time':'anytime',scope:'all',location:'all'});
   if(!Array.isArray(rows)||rows.length>perKeyword)throw Object.assign(new Error('SOURCE_CHANGED'),{code:'SOURCE_CHANGED'});
   completedKeywords.push(keyword);
   if(!rows.length){warnings.push('EMPTY_SEARCH_RESULT');continue;}
   const captured=new Date().toISOString();
   for(const row of rows){
    const identity=noteIdentity(row.url);
    if(items.has(identity.id)||items.size>=keywordMaximum)continue;
    items.set(identity.id,{external_id:identity.id,canonical_url:identity.canonical_url,title:row.title||'无标题笔记',summary:'',author:typeof row.author==='string'?row.author:null,published_at:null,date_label_raw:null,captured_at:captured,actual_source_type:'search',keyword,media_type:'unknown',visible_counts:{},rank:null,reference_only:true});
   }
   // Read at most one detail per keyword; no comments or media downloads.
   if(input.source_type==='xhs_quality_note'){
    await new Promise(r=>setTimeout(r,2500));
    const row=rows[0],identity=noteIdentity(row.url);
    try{
     const detail=await readDetail(row,identity);items.set(identity.id,{...items.get(identity.id),...detail,title:detail.title||items.get(identity.id).title});details.push(identity.id);
    }catch(e){if(['AUTH_REQUIRED','ACCESS_DENIED','RATE_LIMITED'].includes(e.code))throw e;const code=failureCode(e);detailFailures.push({keyword,note_id:identity.id,error_code:code});warnings.push(e.code==='CONTENT_UNAVAILABLE'?'CONTENT_UNAVAILABLE':`DETAIL_READ_FAILED:${keyword}:${code}`);}
   }
   await new Promise(r=>setTimeout(r,2500));
  }
  if(completedKeywords.length<keywords.length)warnings.push('KEYWORD_BUDGET_EXHAUSTED');
  if(accounts.length){
   const {command:user}=await import(pathToFileURL(join(root,'clis/xiaohongshu/user.js')).href);
   for(const accountId of accounts){
    if(items.size>=maximum){warnings.push('REFERENCE_ACCOUNT_BUDGET_EXHAUSTED');break;}
    await new Promise(r=>setTimeout(r,2500));
    try{
     const rows=await user.func(page,{id:accountId,limit:Math.min(perKeyword,maximum-items.size)});
     if(!Array.isArray(rows)||rows.length>perKeyword)throw Object.assign(new Error('SOURCE_CHANGED'),{code:'SOURCE_CHANGED'});
     const captured=new Date().toISOString();let added=0,profileDetailRead=false;
     for(const row of rows){const identity=referenceNoteIdentity(row.url,accountId);if(items.has(identity.id)||items.size>=maximum)continue;
      items.set(identity.id,{external_id:identity.id,canonical_url:identity.canonical_url,title:row.title||'无标题笔记',summary:'',author:accountId,published_at:null,date_label_raw:null,captured_at:captured,actual_source_type:'account_feed',media_type:row.type==='video'?'video':row.type==='normal'?'image':'unknown',visible_counts:{likes:normalizeCount(row.likes)},rank:null,reference_only:true});added++;
      if(!profileDetailRead){profileDetailRead=true;await new Promise(r=>setTimeout(r,2500));
       try{const detail=await readDetail(row,identity);items.set(identity.id,{...items.get(identity.id),...detail,title:detail.title||items.get(identity.id).title});details.push(identity.id);}
       catch(e){if(['AUTH_REQUIRED','ACCESS_DENIED','RATE_LIMITED'].includes(e.code))throw e;const code=failureCode(e);detailFailures.push({reference_account_id:accountId,note_id:identity.id,error_code:code});warnings.push(`REFERENCE_ACCOUNT_DETAIL_FAILED:${code}`);}
      }
     }
     accountResults.push({account_id:accountId,state:'succeeded',returned_items:rows.length,added_items:added});
    }catch(e){if(['AUTH_REQUIRED','ACCESS_DENIED','RATE_LIMITED'].includes(e.code))throw e;
     const code=e.code==='EMPTY_RESULT'?'REFERENCE_ACCOUNT_EMPTY':'REFERENCE_ACCOUNT_READ_FAILED';warnings.push(code);accountResults.push({account_id:accountId,state:'failed',error_code:code});
    }
   }
  }
  if((await page.readNetworkCapture()).length)throw Object.assign(new Error('UNEXPECTED_CAPTURE'),{code:'UNEXPECTED_CAPTURE'});
  return {items:[...items.values()],captured_at:new Date().toISOString(),next_cursor:null,quota_state:{provider_limit_known:false,provider_remaining:null,request_item_limit:maximum},coverage:{actual_source_type:accounts.length?'search_and_account_feed':'search',keywords:completedKeywords,keywords_requested:keywords,detail_count:details.length,detail_ids:details,detail_failures:detailFailures,reference_account_support:'public_profile',reference_accounts:accountResults,reference_accounts_requested:accounts.length,read_comments:false,download_media:false},warnings:[...new Set(warnings)],capabilities:{list_items:true,read_detail:input.source_type==='xhs_quality_note'?details.length>0:null,read_comments:false,historical_metrics:false,own_account_metrics:false},adapter_version:'opencli-1.8.8/yoyo-xhs-v2.1'};
 }finally{await page.closeWindow();}
}
export function failureCode(error){
 if(['AUTH_REQUIRED','ACCESS_DENIED','RATE_LIMITED','SOURCE_CHANGED','TIMEOUT','CONTENT_UNAVAILABLE','DEPENDENCY_CHANGED','PROFILE_REQUIRED','BRIDGE_UNSUPPORTED','INVALID_INPUT'].includes(error?.code))return error.code;
 // Unknown transport/navigation failures must not be re-labelled as login failures or empty results.
 return 'BROWSER_UNAVAILABLE';
}
async function main(){
 let text='';for await(const chunk of process.stdin){text+=chunk;if(text.length>16384)throw new Error('INPUT_TOO_LARGE');}
 try{const result=await collectXhs(JSON.parse(text));process.stdout.write(JSON.stringify({ok:true,result})+'\n');}
 catch(error){process.stdout.write(JSON.stringify({ok:false,error_code:failureCode(error)})+'\n');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{process.stderr.write('SOURCE_ADAPTER_FAILURE\n');process.exitCode=1;});
