import http from 'node:http';
import {readFileSync,createWriteStream,createReadStream} from 'node:fs';
import {mkdtemp,rm,readdir,stat,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {spawn} from 'node:child_process';
import {randomUUID,timingSafeEqual} from 'node:crypto';
const root='/scratch',token=readFileSync(process.env.MEDIA_TOKEN_FILE??'/run/media-token','utf8').trim(),active=new Set();let busy=false;
async function run(dir,command,args,signal){
 return new Promise((resolve,reject)=>{
  const child=spawn('/usr/local/bin/media-sandbox',[dir,'/usr/bin/'+command,...args],{cwd:dir,detached:true,env:{PATH:'/usr/bin',HOME:dir,TMPDIR:dir},stdio:['ignore','pipe','pipe']});let output='',err='';
  const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}};if(signal?.aborted)kill();signal?.addEventListener('abort',kill,{once:true});
  const timeout=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},120000);
  child.stdout.on('data',b=>{if(output.length>20*1024*1024){try{process.kill(-child.pid,'SIGKILL');}catch{}}else output+=b;});child.stderr.on('data',b=>{if(err.length<2000)err+=b;});
  child.on('error',e=>{clearTimeout(timeout);signal?.removeEventListener('abort',kill);reject(e);});child.on('close',code=>{clearTimeout(timeout);signal?.removeEventListener('abort',kill);try{process.kill(-child.pid,'SIGKILL');}catch{}code===0?resolve(output):reject(Object.assign(new Error('MEDIA_PARSE_FAILED'),{exitCode:code}));});
 });
}
async function parse(dir,mime,signal){
 const execute=(command,args)=>run(dir,command,args,signal);
 const input=join(dir,'input'),output=[];let metadata={};
 if(mime==='application/pdf'){
  const info=await execute('pdfinfo',[input]);const pages=Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);if(!pages||pages>2000)throw new Error('PDF_PAGE_LIMIT');metadata={pages,pdf_page_order:true};
  await execute('pdftotext',['-layout',input,join(dir,'text.txt')]);
  const size=(await stat(join(dir,'text.txt'))).size;if(size>20*1024*1024)throw new Error('PDF_TEXT_LIMIT');metadata.text=(await readFile(join(dir,'text.txt'),'utf8')).slice(0,1000000);
  for(let n=1;n<=pages;n++){await execute('pdftoppm',['-f',String(n),'-l',String(n),'-scale-to','1200','-png','-singlefile',input,join(dir,'page-'+n)]);output.push({name:'page-'+n+'.png',mime:'image/png',page:n});}
 }else if(mime==='image/png'){
  metadata=JSON.parse(await execute('python3',['/usr/local/lib/yoyo/png-preview.py',input,join(dir,'preview.png')]));output.push({name:'preview.png',mime:'image/png'});
 }else return {status:'unsupported',metadata:{},outputs:[]};
 return {status:'ready',metadata,outputs:output};
}
for(const dir of await readdir(root))await rm(join(root,dir),{recursive:true,force:true});
const server=http.createServer(async(req,res)=>{
 const auth=Buffer.from(req.headers['x-media-token']??'');const expected=Buffer.from(token);if(auth.length!==expected.length||!timingSafeEqual(auth,expected)){res.writeHead(403);res.end();return;}
 try{
  if(req.method==='POST'&&req.url==='/process'){
   if(busy){res.writeHead(429);res.end();return;}busy=true;const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});const id=randomUUID(),dir=join(root,id);await import('node:fs/promises').then(f=>f.mkdir(dir,{mode:0o700}));active.add(id);
   try{let size=0;await pipeline(req,new Transform({transform(b,e,cb){size+=b.length;cb(size>2147483648?new Error('FILE_TOO_LARGE'):null,b);}}),createWriteStream(join(dir,'input'),{flags:'wx'}));const result=await parse(dir,String(req.headers['x-media-mime']),controller.signal);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id,...result}));}
   catch(e){await rm(dir,{recursive:true,force:true});active.delete(id);res.writeHead(422);res.end(JSON.stringify({code:String(req.headers['x-media-mime'])==='image/png'&&e.exitCode===1?'INVALID_PNG':'MEDIA_PARSE_FAILED'}));}
   finally{busy=false;}return;
  }
  const m=req.url?.match(/^\/outputs\/([a-f0-9-]{36})(?:\/((?:page-\d+|preview|poster)\.(?:png|mp4|m4a)))?$/);if(!m||!active.has(m[1])){res.writeHead(404);res.end();return;}
  if(req.method==='DELETE'&&!m[2]){await rm(join(root,m[1]),{recursive:true,force:true});active.delete(m[1]);res.end('{}');return;}
  if(req.method==='GET'&&m[2]){const path=join(root,m[1],m[2]),s=await stat(path);res.setHeader('Content-Length',s.size);await pipeline(createReadStream(path),res);return;}
  res.writeHead(404);res.end();
 }catch{if(!res.headersSent)res.writeHead(500);res.end();}
});server.requestTimeout=600000;server.listen(9010,'0.0.0.0');
setInterval(async()=>{for(const id of active){const s=await stat(join(root,id)).catch(()=>null);if(s&&Date.now()-s.mtimeMs>3600000&&!busy){await rm(join(root,id),{recursive:true,force:true});active.delete(id);}}},60000).unref();
