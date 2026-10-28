/** Authenticated fixed RPCs; collection and account verification share profile locks. */
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,timingSafeEqual} from 'node:crypto';
const root=()=>resolve(process.env.OPENCLI_ROOT??'.local/providers/opencli/node_modules/@jackwener/opencli');
export async function listConnectedProfiles(){
 const pkg=JSON.parse(readFileSync(join(root(),'package.json'),'utf8'));if(pkg.version!=='1.8.8')throw Error('DEPENDENCY_CHANGED');
 const {fetchDaemonStatus}=await import(pathToFileURL(join(root(),'dist/src/browser/daemon-transport.js')).href);
 const status=await fetchDaemonStatus();if(!status||!Array.isArray(status.profiles))throw Error('BROWSER_UNAVAILABLE');
 return status.profiles.filter(p=>typeof p.contextId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(p.contextId)).slice(0,50).map(p=>({id:p.contextId}));
}
async function canonicalProfile(profile){const {resolveProfileContextId}=await import(pathToFileURL(join(root(),'dist/src/browser/profile.js')).href);return resolveProfileContextId(profile);}
function runChild(script,input,res){return new Promise((accept,reject)=>{
 const controller=new AbortController();const abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
 const child=execFile(process.execPath,[resolve(script)],{signal:controller.signal,timeout:90000,maxBuffer:2000000},(error,stdout)=>{res.off('close',abort);if(error)return reject(new Error(controller.signal.aborted?'TIMEOUT':'BROWSER_UNAVAILABLE'));try{accept(JSON.parse(stdout));}catch{reject(new Error('PARSE_FAILED'));}});child.stdin.end(JSON.stringify(input));
});}
export function createSourceBridge({token,profiles=listConnectedProfiles,canonical=canonicalProfile,run=runChild}){
 if(typeof token!=='string'||token.length<32)throw Error('SOURCE_BRIDGE_TOKEN_INVALID');
 const digest=v=>createHash('sha256').update(v).digest(),occupied=new Set();
 const server=createServer(async(req,res)=>{
  const send=(status,value)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}};
  if(!timingSafeEqual(digest(req.headers.authorization??''),digest('Bearer '+token)))return send(401,{ok:false,error_code:'BRIDGE_UNAUTHORIZED'});
  if(req.url==='/health'&&req.method==='GET')return send(200,{ok:true,provider:'opencli-1.8.8',account_verification:true});
  if(req.url==='/profiles'&&req.method==='GET'){try{return send(200,{ok:true,items:await profiles()});}catch{return send(503,{ok:false,error_code:'BROWSER_UNAVAILABLE'});}}
  const verify=req.url==='/accounts/verify';if(!['/collect','/accounts/verify'].includes(req.url)||req.method!=='POST')return send(404,{ok:false,error_code:'NOT_FOUND'});
  let body='',profile,acquired=false;
  try{
   for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16384)return send(413,{ok:false,error_code:'INVALID_INPUT'});}
   const input=JSON.parse(body),requested=verify?input.profile:input.config?.profile;
   if(typeof requested!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(requested))return send(422,{ok:false,error_code:'PROFILE_REQUIRED'});
   if(verify){if(Object.keys(input).sort().join(',')!=='profile,target_id'||!/^[a-f0-9]{24}$/.test(input.target_id))return send(422,{ok:false,error_code:'INVALID_INPUT'});}
   else if(!['xhs_topic_signal','xhs_quality_note'].includes(input.source_type))return send(422,{ok:false,error_code:'INVALID_INPUT'});
   profile=await canonical(requested);if(!profile||!/^[A-Za-z0-9_-]{1,100}$/.test(profile))return send(422,{ok:false,error_code:'PROFILE_REQUIRED'});
   if(verify&&(profile!==requested||!(await profiles()).some(p=>p.id===profile)))return send(422,{ok:false,error_code:'PROFILE_UNAVAILABLE'});
   if(occupied.has(profile))return send(409,{ok:false,error_code:'BROWSER_BUSY'});occupied.add(profile);acquired=true;
   const normalized=verify?{profile,target_id:input.target_id}:{...input,config:{...input.config,profile}};
   send(200,await run(verify?'tools/s3/xhs-account-verify.mjs':'tools/s3/xhs-collector.mjs',normalized,res));
  }catch(error){send(503,{ok:false,error_code:['BROWSER_UNAVAILABLE','PARSE_FAILED','TIMEOUT'].includes(error.message)?error.message:'INVALID_INPUT'});}
  finally{if(acquired)occupied.delete(profile);}
 });
 server.requestTimeout=100000;server.headersTimeout=10000;return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const token=readFileSync(process.env.SOURCE_BRIDGE_TOKEN_FILE??resolve(process.env.STATE_DIR??'.local/state','source-bridge-token'),'utf8').trim();const server=createSourceBridge({token});
 server.listen(Number(process.env.SOURCE_BRIDGE_PORT??59025),process.env.SOURCE_BRIDGE_HOST??'127.0.0.1',()=>console.log(JSON.stringify({event:'source.bridge.ready',port:server.address().port})));
 for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>server.close(()=>process.exit()));
}
