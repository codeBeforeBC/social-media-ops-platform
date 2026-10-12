import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const dir='.local/s9-recovery-arm64-4',project='yoyo-s9-recovery-arm64-4',files=['compose.yaml','compose.release.yaml','compose.https.yaml','compose.release-https.yaml'];
const digest=version=>execFileSync('docker',['run','--rm','--network','none',`yoyo-release:${version}-arm64`,'node','-e',`const fs=require('node:fs'),path=require('node:path'),h=require('node:crypto').createHash('sha256');function visit(p){for(const f of fs.readdirSync(p).sort()){const n=path.join(p,f);if(fs.statSync(n).isDirectory())visit(n);else h.update(n).update(fs.readFileSync(n));}}for(const p of ['dist/apps/api','dist/apps/worker','dist/apps/scheduler','dist/packages','apps/web/dist'])visit(p);console.log(h.digest('hex'));`],{encoding:'utf8'}).trim();
const old='0.1.0-s9rc9',next='0.1.0-s9rc10';assert.equal(digest(old),digest(next),'Rollback allowed only after compiled application compatibility is proven');
function compose(version,args){return execFileSync('docker',['compose','-p',project,...files.flatMap(f=>['-f',dir+'/'+f]),...args],{env:{...process.env,YOYO_VERSION:version,YOYO_ARCH:'arm64',HTTPS_ORIGIN:'https://localhost:3443',HTTPS_PORT:'3443',SOURCE_BRIDGE_URL:''},encoding:'utf8',maxBuffer:10000000});}
const sql=(version,q)=>compose(version,['exec','-T','db','psql','-U','yoyo','-d','yoyo','-Atc',q]).trim();
const snapshot=version=>sql(version,"SELECT json_build_object('publications',(SELECT json_agg(row_to_json(p) ORDER BY id) FROM publications p),'observations',(SELECT json_agg(row_to_json(o) ORDER BY id) FROM metric_observations o),'supersessions',(SELECT json_agg(row_to_json(s) ORDER BY id) FROM observation_supersessions s),'files',(SELECT json_agg(row_to_json(f) ORDER BY id) FROM file_objects f),'evidence',(SELECT json_agg(row_to_json(e) ORDER BY id) FROM metric_evidence e))::text");
try{
 compose(next,['up','-d','--pull','never','--wait']);const before=snapshot(next);
 compose(old,['up','-d','--pull','never','--force-recreate','--wait']);assert.equal(snapshot(old),before);assert.equal(sql(old,'SELECT count(*) FROM schema_migrations'),'37');
 compose(next,['up','-d','--pull','never','--force-recreate','--wait']);assert.equal(snapshot(next),before);
 writeFileSync('docs/evidence/s9/compatible-rollback.json',JSON.stringify({checked_at:new Date().toISOString(),project,versions:[next,old,next],compiled_application_identical:true,business_snapshot_sha256:createHash('sha256').update(before).digest('hex'),schema_migrations:37,database_downgrade_applied:false,original_use_instances_changed:false,result:'passed_compatible_build_switch_only'},null,2)+'\n');console.log('Compatible build switch and return passed; no database downgrade claimed.');
}finally{compose(next,['stop']);}
