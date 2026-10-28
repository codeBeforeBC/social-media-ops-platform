/** Fixed, bounded identity-only browser action. Never reads cookies or creator metrics. */
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {IDENTITY_SNAPSHOT_JS,classifyIdentity} from '../s0/probe-xhs-account-identity.mjs';
import {prepareNavigation} from '../s0/probe-xhs-navigation.mjs';
export function publicIdentity(snapshot,target){
 if(snapshot?.security_block)return {status:'inconclusive',code:'ACCESS_DENIED'};
 if(snapshot?.login_wall)return {status:'inconclusive',code:'AUTH_REQUIRED'};
 const actual=snapshot?.path?.match(/^\/user\/profile\/([a-f0-9]{24})\/?$/i)?.[1]?.toLowerCase();
 if(actual!==target||!snapshot?.nickname?.trim()||!snapshot?.display_number?.trim())return {status:'inconclusive',code:'SOURCE_CHANGED'};
 return {status:'matched',code:null,profile:{id:target,nickname:snapshot.nickname.trim().slice(0,200),display_handle:snapshot.display_number.trim().slice(0,200)}};
}
export async function verifyAccount({profile,target_id:target}){
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(profile)||!/^[a-f0-9]{24}$/.test(target))throw new Error('INVALID_INPUT');
 const root=resolve(process.env.OPENCLI_ROOT??'.local/providers/opencli/node_modules/@jackwener/opencli');
 const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));if(pkg.version!=='1.8.8'||pkg.name!=='@jackwener/opencli')throw new Error('DEPENDENCY_CHANGED');
 const {Page}=await import(pathToFileURL(join(root,'dist/src/browser/page.js')).href);
 const page=new Page('yoyo-account-verify:'+randomUUID(),60,profile,'background','adapter','ephemeral');
 const result={public_status:'inconclusive',session_status:'unknown',public_profile:null,session_id:null,observed_at:new Date().toISOString(),adapter_version:'opencli-1.8.8/account-v1',capabilities:{public_identity:'unknown',current_session_identity:'unknown',own_account_metrics:'unknown'},error_code:null};
 async function observe(check){let snap,classified;const deadline=Date.now()+12000;do{snap=await page.evaluate(IDENTITY_SNAPSHOT_JS);classified=check(snap);if(classified.ready||snap.security_block||snap.login_wall)break;await new Promise(r=>setTimeout(r,400));}while(Date.now()<deadline);return snap;}
 try{
  await prepareNavigation(page);await page.goto('https://www.xiaohongshu.com/explore');
  const session=await observe(s=>({ready:classifyIdentity(s).state==='matched'})),identity=classifyIdentity(session);
  if(session.security_block){result.error_code='ACCESS_DENIED';return result;}
  if(identity.state==='matched'){result.session_id=identity.session_id;result.session_status=identity.session_id===target?'matched':'mismatched';result.capabilities.current_session_identity='supported';}
  else if(identity.state==='auth_required')result.session_status='auth_required';
  await new Promise(r=>setTimeout(r,2500));await page.goto('https://www.xiaohongshu.com/user/profile/'+target);
  const snapshot=await observe(s=>({ready:publicIdentity(s,target).status==='matched'})),publicResult=publicIdentity(snapshot,target),secondSession=classifyIdentity(snapshot);
  if(result.session_id&&secondSession.state==='matched'&&secondSession.session_id!==result.session_id){result.session_status='unknown';result.session_id=null;result.error_code='SOURCE_CHANGED';}
  else if(snapshot.login_wall){result.session_status='auth_required';result.session_id=null;}
  result.public_status=publicResult.status;result.public_profile=publicResult.profile??null;result.capabilities.public_identity=publicResult.status==='matched'?'supported':'unknown';
  result.error_code=result.error_code??publicResult.code??(result.session_status==='mismatched'?'ACCOUNT_MISMATCH':result.session_status==='auth_required'?'AUTH_REQUIRED':null);
  return result;
 }catch(e){result.error_code=['AUTH_REQUIRED','ACCESS_DENIED','RATE_LIMITED','TIMEOUT','BRIDGE_UNSUPPORTED'].includes(e.code)?e.code:'BROWSER_UNAVAILABLE';return result;}
 finally{result.observed_at=new Date().toISOString();await page.closeWindow().catch(()=>{});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 let input='';try{for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>4096)throw Error();}const result=await verifyAccount(JSON.parse(input));console.log(JSON.stringify({ok:true,result}));}catch{console.log(JSON.stringify({ok:false,error_code:'BROWSER_UNAVAILABLE'}));process.exitCode=1;}
}
