/** P02 capability probe, not a product verification endpoint. No cookies or metric reads. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {prepareNavigation} from './probe-xhs-navigation.mjs';

const stableId=value=>typeof value==='string'&&/^[a-f0-9]{24}$/i.test(value)?value.toLowerCase():null;
const sha=value=>createHash('sha256').update(value).digest('hex');
function fail(code){throw Object.assign(new Error(code),{code});}
export function classifyIdentity(snapshot,expectedId=null){
  if(!snapshot||typeof snapshot!=='object')return {state:'inconclusive',error_code:'PARSE_FAILED'};
  if(snapshot.security_block)return {state:'inconclusive',error_code:'ACCESS_DENIED'};
  if(snapshot.login_wall)return {state:'auth_required',error_code:'AUTH_REQUIRED'};
  const own=[...new Set((snapshot.own_ids??[]).map(stableId).filter(Boolean))];
  const current=stableId(snapshot.current_user_id);
  if(own.length!==1||!current||current!==own[0])return {state:'inconclusive',error_code:'IDENTITY_EVIDENCE_INCONSISTENT'};
  if(expectedId){
    const pathId=snapshot.path?.match(/^\/user\/profile\/([a-f0-9]{24})\/?$/i)?.[1]?.toLowerCase();
    if(pathId!==stableId(expectedId)||!snapshot.nickname?.trim()||!snapshot.display_number?.trim())return {state:'inconclusive',error_code:'PROFILE_NOT_READY'};
    return {state:'matched',public_id:pathId,session_id:current,session_matches_target:current===pathId};
  }
  return {state:'matched',session_id:current};
}

// Extract only identity fields. The entire user store can contain signed tokens and must never leave the page.
export const IDENTITY_SNAPSHOT_JS=`(()=>{
  const unwrap=v=>v?._value??v;
  const user=window.__INITIAL_STATE__?.user,info=unwrap(user?.userInfo)||{};
  const ownIds=[...document.querySelectorAll('a')].filter(a=>a.textContent.trim()==='我').map(a=>{try{const u=new URL(a.href);return u.origin==='https://www.xiaohongshu.com'?u.pathname.match(/^\\/user\\/profile\\/([a-f0-9]{24})\\/?$/i)?.[1]??null:null;}catch{return null;}}).filter(Boolean);
  const visible=s=>{const e=document.querySelector(s);return !!e&&e.getBoundingClientRect().height>0;};
  const title=document.title||'';
  return {path:location.pathname,own_ids:ownIds,current_user_id:info.userId??info.user_id??null,
    nickname:document.querySelector('.user-name')?.textContent?.trim()?.slice(0,200)||null,
    display_number:document.querySelector('.user-redId')?.textContent?.trim()?.replace(/^小红书号[：:]\\s*/,'')?.slice(0,200)||null,
    login_wall:location.pathname.startsWith('/login')||unwrap(user?.loggedIn)===false,
    security_block:/安全验证|访问受限/.test(title)||visible('.captcha-modal-wrapper')||visible('.red-captcha-dialog')};
})()`;

export async function probeIdentity({profile,targetId=null,opencliRoot=process.env.OPENCLI_ROOT??'.local/providers/opencli/node_modules/@jackwener/opencli'}){
  if(typeof profile!=='string'||!profile||profile.length>100)fail('PROFILE_REQUIRED');
  if(targetId!==null&&!stableId(targetId))fail('INVALID_ACCOUNT_ID');
  const root=resolve(opencliRoot),pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  if(pkg.name!=='@jackwener/opencli'||pkg.version!=='1.8.8')fail('DEPENDENCY_CHANGED');
  const {Page}=await import(pathToFileURL(join(root,'dist/src/browser/page.js')).href);
  const page=new Page('yoyo-account-probe:'+randomUUID(),60,profile,'background','adapter','ephemeral');
  const report={started_at:new Date().toISOString(),provider:'opencli-1.8.8',scope:'P02_readonly_identity_capability_probe',target_basis:targetId?'explicit_target':'current_session_account',steps:[]};
  async function observe(expected=null){
    const until=Date.now()+12000;let snapshot,result;
    do{
      snapshot=await page.evaluate(IDENTITY_SNAPSHOT_JS);result=classifyIdentity(snapshot,expected);
      if(result.state==='matched'||['AUTH_REQUIRED','ACCESS_DENIED'].includes(result.error_code))return {snapshot,result,observed_at:new Date().toISOString()};
      await new Promise(r=>setTimeout(r,400));
    }while(Date.now()<until);
    return {snapshot,result,observed_at:new Date().toISOString()};
  }
  try{
    await prepareNavigation(page);
    await page.goto('https://www.xiaohongshu.com/explore');const session=await observe();report.steps.push({check:'current_session',...session});
    if(session.result.state!=='matched')return {...report,result:'inconclusive',finished_at:new Date().toISOString()};
    const target=stableId(targetId)??session.result.session_id;
    await new Promise(r=>setTimeout(r,2500));
    await page.goto('https://www.xiaohongshu.com/user/profile/'+target);const publicProfile=await observe(target);report.steps.push({check:'public_profile',...publicProfile});
    const publicMatch=publicProfile.result.state==='matched',sameSession=publicMatch&&session.result.session_id===publicProfile.result.session_id;
    return {...report,result:publicMatch&&sameSession?'passed_identity_mapping_only':'inconclusive',target_id:target,
      session_consistent_between_pages:sameSession,
      public_identity_evidence:'rendered_profile_path_plus_nickname_and_display_number',
      session_identity_evidence:'sidebar_own_profile_link_agrees_with_current_user_store',
      capabilities:{public_identity:publicMatch?'supported':'unknown',current_session_identity:'supported',own_account_metrics:'unknown'},
      finished_at:new Date().toISOString()};
  }catch(error){return {...report,result:'inconclusive',error_code:['AUTH_REQUIRED','ACCESS_DENIED','TIMEOUT','BRIDGE_UNSUPPORTED'].includes(error.code)?error.code:'BROWSER_UNAVAILABLE',finished_at:new Date().toISOString()};}
  finally{await page.closeWindow().catch(()=>{});}
}

export function redactProbe(report){
  return {...report,steps:report.steps.map(step=>({check:step.check,observed_at:step.observed_at,state:step.result.state,error_code:step.result.error_code??null,
    session_id_sha256:step.result.session_id?sha(step.result.session_id):null,public_id_sha256:step.result.public_id?sha(step.result.public_id):null,
    session_matches_target:step.result.session_matches_target??null,nickname_present:!!step.snapshot?.nickname,display_number_present:!!step.snapshot?.display_number,
    security_block:step.snapshot?.security_block??null,login_wall:step.snapshot?.login_wall??null})),target_id:undefined,
    target_id_sha256:report.target_id?sha(report.target_id):null,credentials_printed:false,metrics_imported:false,product_verification_written:false};
}

async function main(){
  const args=process.argv.slice(2),opts={};
  for(let i=0;i<args.length;i+=2){if(!['--profile','--target-id','--output','--report','--opencli-root'].includes(args[i])||!args[i+1])fail('INVALID_INPUT');opts[args[i]]=args[i+1];}
  if(!opts['--output']||!opts['--report'])fail('OUTPUT_REQUIRED');
  const report=await probeIdentity({profile:opts['--profile'],targetId:opts['--target-id']??null,opencliRoot:opts['--opencli-root']});
  await mkdir(dirname(resolve(opts['--output'])),{recursive:true,mode:0o700});await writeFile(opts['--output'],JSON.stringify(report,null,2)+'\n',{mode:0o600});
  await mkdir(dirname(resolve(opts['--report'])),{recursive:true});const safe=redactProbe(report);await writeFile(opts['--report'],JSON.stringify(safe,null,2)+'\n');
  console.log(JSON.stringify({result:safe.result,capabilities:safe.capabilities,credentials_printed:false}));
  if(report.result!=='passed_identity_mapping_only')process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('IDENTITY_PROBE_FAILED');process.exitCode=1;});
