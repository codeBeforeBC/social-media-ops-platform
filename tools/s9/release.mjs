/** Build a private, immutable offline bundle; publishing is a separate authorized action. */
import {execFileSync} from 'node:child_process';
import {mkdirSync,copyFileSync,writeFileSync,readFileSync,statSync,chmodSync,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const version=process.argv[2],out=resolve(process.argv[3]??'.local/releases/'+version);
assert.match(version??'',/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/,'explicit fixed version required');
mkdirSync(resolve(out,'..'),{recursive:true,mode:0o700});mkdirSync(out,{recursive:false,mode:0o700});
const run=(args)=>execFileSync('docker',args,{stdio:'inherit'});
const inspect=(tag,platform)=>JSON.parse(execFileSync('docker',['image','inspect','--platform',platform,tag],{encoding:'utf8'}))[0];
async function digest(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
const dependencies=['postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3','chrislusf/seaweedfs:4.15@sha256:1593bd2a98964f5d4df83fa7db2b3d4ee7b20190813cc5bf8c3200e0e70d346e','caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d'];
// Freeze one context for both architectures, including untracked implementation, excluding private inputs.
const source=join(out,'source');mkdirSync(source);
const source_files=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{encoding:'utf8'}).split('\0').filter(p=>p&&!p.startsWith('docs/evidence/')).sort().map(path=>{
 assert.ok(!path.startsWith('.local/')&&(path==='.env.example'||!/^\.env(?:$|\.)/.test(path)));
 const content=readFileSync(path),target=join(source,path);mkdirSync(resolve(target,'..'),{recursive:true});writeFileSync(target,content);
 return {path,sha256:createHash('sha256').update(content).digest('hex')};
});
assert.ok(source_files.some(f=>f.path==='tools/s9/release.mjs'));assert.ok(source_files.some(f=>f.path==='tools/init-state.mjs'));
const manifest={version,created_at:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source_files,source_sha256:createHash('sha256').update(JSON.stringify(source_files)).digest('hex'),platforms:[]};
for(const arch of ['arm64','amd64']){
 const platform='linux/'+arch,app=`yoyo-release:${version}-${arch}`,parser=`yoyo-parser-release:${version}-${arch}`;
 for(const [tag,file] of [[app,'Dockerfile'],[parser,'tools/media/Dockerfile']])run(['buildx','build','--platform',platform,'--load','-f',join(source,file),'-t',tag,source]);
 run(['run','--rm','--platform',platform,'--network','none',app,'node','-e',"require('argon2');require('pg');require('@prisma/client');require('node:fs').accessSync('tools/init-state.mjs');require('node:fs').accessSync('docs/templates/yoyo-import-v1.xlsx');console.log('native dependencies and release files ready')"]);
 run(['run','--rm','--platform',platform,'--network','none',parser,'sh','-c','python3 -c "from PIL import Image" && test -x /usr/local/bin/media-sandbox']);
 for(let i=0;i<dependencies.length;i++){
  // Content-addressed local images need no registry contact; missing platforms still require a pull.
  let cached;try{cached=inspect(dependencies[i],platform);}catch{}
  if(!cached)run(['pull','--platform',platform,dependencies[i]]);
  const dependency=inspect(dependencies[i],platform);assert.equal(dependency.Architecture,arch);assert.ok(dependency.RepoDigests.some(d=>d.endsWith('@'+dependencies[i].split('@')[1])));
  run(['tag',dependencies[i],`yoyo-dependency-${i}:${version}-${arch}`]);
 }
 const file=`images-${arch}.tar`,tags=[app,parser,...dependencies.map((_,i)=>`yoyo-dependency-${i}:${version}-${arch}`)];
 run(['save','--platform',platform,'-o',join(out,file),...tags]);
 const images=tags.map(tag=>{const image=inspect(tag,platform);assert.equal(image.Architecture,arch);return {tag,id:image.Id};});
 const sha256=await digest(join(out,file));
 writeFileSync(join(out,`images-${arch}.sha256`),sha256+'  '+file+'\n');
 writeFileSync(join(out,`images-${arch}.ids`),images.map(i=>i.tag+' '+i.id).join('\n')+'\n');
 manifest.platforms.push({platform,file,sha256,bytes:statSync(join(out,file)).size,images,dependencies});
 writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
}
for(const file of ['compose.yaml','compose.release.yaml','compose.https.yaml','compose.release-https.yaml','.env.example','tools/s9/load-release.sh','tools/s9/backup.sh','tools/s9/restore.sh','deploy/Caddyfile']){
 const target=join(out,file);mkdirSync(resolve(target,'..'),{recursive:true});copyFileSync(join(source,file),target);
 if(file.endsWith('.sh'))chmodSync(target,0o700);
}
console.log(JSON.stringify({version,out,platforms:manifest.platforms.map(p=>p.platform),published:false}));
