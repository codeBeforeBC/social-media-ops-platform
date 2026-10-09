/** Host-only RPC for Docker workers using the existing authenticated browser. */
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash,timingSafeEqual} from 'node:crypto';
const token=readFileSync(process.env.SOURCE_BRIDGE_TOKEN_FILE??resolve(process.env.STATE_DIR??'.local/state','source-bridge-token'),'utf8').trim();
if(token.length<32)throw new Error('SOURCE_BRIDGE_TOKEN_INVALID');
const digest=v=>createHash('sha256').update(v).digest();const occupied=new Set();
const server=createServer(async(req,res)=>{
 const send=(status,value)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}};
 if(!timingSafeEqual(digest(req.headers.authorization??''),digest('Bearer '+token)))return send(401,{ok:false,error_code:'BRIDGE_UNAUTHORIZED'});
 if(req.url==='/health'&&req.method==='GET')return send(200,{ok:true,provider:'opencli-1.8.8'});
 if(req.url!=='/collect'||req.method!=='POST')return send(404,{ok:false,error_code:'NOT_FOUND'});
 let body='',profile,acquired=false;
 try{for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16384)return send(413,{ok:false,error_code:'INVALID_INPUT'});}
  const input=JSON.parse(body);profile=input.config?.profile;
  if(!['xhs_topic_signal','xhs_quality_note'].includes(input.source_type)||typeof profile!=='string'||!profile||profile.length>100)return send(422,{ok:false,error_code:'INVALID_INPUT'});
  if(occupied.has(profile))return send(409,{ok:false,error_code:'BROWSER_BUSY'});occupied.add(profile);acquired=true;
  const output=await new Promise((accept,reject)=>{const controller=new AbortController();const abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);const child=execFile(process.execPath,[resolve('tools/s3/xhs-collector.mjs')],{signal:controller.signal,timeout:90000,maxBuffer:2000000},(error,stdout)=>{res.off('close',abort);if(error)return reject(new Error('BROWSER_UNAVAILABLE'));try{accept(JSON.parse(stdout));}catch{reject(new Error('PARSE_FAILED'));}});child.stdin.end(JSON.stringify(input));});
  send(200,output);
 }catch(error){send(503,{ok:false,error_code:['BROWSER_UNAVAILABLE','PARSE_FAILED'].includes(error.message)?error.message:'INVALID_INPUT'});}
 finally{if(acquired)occupied.delete(profile);}
});
server.requestTimeout=100000;server.headersTimeout=10000;
server.listen(Number(process.env.SOURCE_BRIDGE_PORT??59025),process.env.SOURCE_BRIDGE_HOST??'127.0.0.1',()=>console.log(JSON.stringify({event:'source.bridge.ready',port:server.address().port})));
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>server.close(()=>process.exit()));
