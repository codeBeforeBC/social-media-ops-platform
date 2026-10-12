/** Authorized screenshots and verified platform identity in a disposable workbench. */
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {server,Client,initialize} from '../../tests/helpers';
import {uploadBytes} from '../../tests/file-helpers';
import {Storage} from '../../packages/domain/src/storage';
import {Jobs} from '../../packages/domain/src/jobs';
import {fileValidationHandler} from '../../packages/domain/src/media';
import {importParseHandler} from '../../packages/domain/src/imports';
async function main(){
const env=await server(),c=new Client(env.url),store=new Storage();
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const root='.local/s9-creator-probe/';
const source=JSON.parse(readFileSync('docs/evidence/s0/backend-ocr-probe.json','utf8'));
const identity=JSON.parse(readFileSync('docs/evidence/s0/backend-identity.json','utf8'));
const feed=JSON.parse(readFileSync(root+'own-notes-20261012.json','utf8'));
assert.equal(identity.result,'passed_identity_mapping_only');assert.equal(sha(feed.id),identity.account_identity_sha256);
const jobs=new Jobs(env.db,{'file.validate':fileValidationHandler(env.db,store),'import.parse':importParseHandler(env.db)});
async function drain(){await jobs.dispatch();for(const pool of ['media','general'])for(let i=0;i<30;i++){const j=await jobs.claim(pool);if(!j)break;await jobs.process(j);}}
const report:any={checked_at:new Date().toISOString(),input_classification:'real_authorized_screenshots_verified_platform_identity_in_disposable_workbench',account_identity_namespace:identity.identity_namespace,account_identity_sha256:identity.account_identity_sha256,verified_platform_identity:true,complete_real_account_integration:false,video_sample:'missing',checks:[]};
try{
 await initialize(c);
 const account=(await c.call('/accounts','POST',{platform:'xiaohongshu',platform_user_id:feed.id,name:'已核验授权账号（隔离验收）'})).data;
 const ids=JSON.parse(readFileSync(root+'note-ids.json','utf8'));
 assert.ok(feed.notes.some((n:any)=>n.id===ids[0].noteId));
 const publication=(await c.call('/publications','POST',{account_id:account.id,platform_note_id:ids[0].noteId,url:'https://www.xiaohongshu.com/explore/'+ids[0].noteId,title:'授权图文原图技术验证',media_type:'graphic',published_at:source.manual_mapping.graphic.published_at,traffic_type:'unknown'})).data;
 for(const [kind,name,key,value,unit] of [['account','account.png','followers','545','人'],['graphic','graphic-metrics.png','reads','25052','次']]){
  const bytes=readFileSync(root+name!),original=source.sources.find((s:any)=>s.private_path===root+name);assert.equal(sha(bytes),original.sha256);
  const file=await uploadBytes(c,env.url,account.id,bytes,'授权原图-'+kind+'.png');await drain();
  const info=(await c.call('/files/'+file.id)).data;assert.equal(info.file_status,'ready');assert.equal(info.metadata.ocr_parser_version,'ocr-v1');
  const b=(await c.call('/imports','POST',{account_id:account.id,file_ids:[file.id],source_type:'screenshot'})).data;await drain();
  const rows=(await c.call('/imports/'+b.id+'/rows')).data.items;assert.ok(rows.length>0);assert.ok(rows.every((r:any)=>r.status==='excluded'&&r.metric===null));
  const chosen=kind==='account'?rows.find((r:any)=>r.raw.metric_key==='followers'&&r.raw.value==='545')??rows[0]:rows.find((r:any)=>r.raw.metric_key==='')??rows[0];
  const vision=JSON.parse(readFileSync(root+(kind==='account'?'account-vision.json':'graphic-vision.json'),'utf8'));
  const observed=vision.observations.find((r:any)=>kind==='account'?r.text.includes('545粉丝'):r.text==='25052');assert.ok(observed);
  const box=observed.bounding_box,w=info.metadata.width,h=info.metadata.height;
  const region={x:Math.floor(box.x*w),y:Math.floor((1-box.y-box.height)*h),width:Math.max(1,Math.floor(box.width*w)),height:Math.max(1,Math.floor(box.height*h))};
  const at=new Date(statSync(root+name!).mtime);at.setUTCSeconds(0,0);
  const metric={target:{account_id:account.id,publication_id:kind==='graphic'?publication.id:null},metric_key:key,definition_version:'1',aggregation_kind:kind==='account'?'snapshot':'cumulative',value,unit,observed_at:at.toISOString(),time_precision:'minute',traffic_type:'unknown',source_definition:kind==='account'?'小红书创作者后台当前粉丝总数':'小红书单篇图文后台实时观看次数，累计快照',source_note:'真实授权后台原图，Vision辅助定位并由Codex核对；稳定账号身份已匹配，工作区为隔离验收',is_approximate:false};
  const changed=await c.call('/import-rows/'+chosen.id,'PATCH',{metric,source_region:region,reason:'对照原图核对实际字段与窗口；保留识别原文和区域',expected_version:chosen.version});assert.equal(changed.status,200,changed.error?.code);assert.deepEqual(changed.data.raw,chosen.raw);
  const current=(await c.call('/imports/'+b.id)).data;assert.equal((await c.call('/imports/'+b.id+'/confirm','POST',{row_ids:[chosen.id],conflict_resolutions:[],reason:'已匹配授权账号的原图真实值验证，缺视频不称完整验收',expected_version:current.version})).status,200);
  const signed=(await c.call('/files/'+file.id+'/download')).data;const downloaded=Buffer.from(await(await fetch(signed.url)).arrayBuffer());assert.equal(sha(downloaded),original.sha256);
  const observation=(await env.db.query("SELECT o.id,o.metric FROM metric_observations o JOIN metric_evidence e ON e.observation_id=o.id WHERE e.row_id=$1 AND e.active",[chosen.id])).rows[0];assert.equal(observation.metric.value,value);
  const duplicate=await c.call('/imports','POST',{account_id:account.id,file_ids:[file.id],source_type:'screenshot',manual_rows:[metric],source_region:region});assert.equal(duplicate.status,202,duplicate.error?.code);
  const duplicateRows=(await c.call('/imports/'+duplicate.data.id+'/rows')).data.items;const second=await c.call('/imports/'+duplicate.data.id+'/confirm','POST',{row_ids:[duplicateRows[0].id],conflict_resolutions:[],reason:'相同真实原图值重复确认，不叠加',expected_version:duplicate.data.version});assert.equal(second.status,200,second.error?.code);
  const supports=await env.db.query('SELECT count(*)::int n FROM metric_evidence WHERE observation_id=$1 AND active AND supports_value',[observation.id]);assert.equal(supports.rows[0].n,2);
  const firstCurrent=(await c.call('/imports/'+b.id)).data;assert.equal((await c.call('/imports/'+b.id+'/revert','POST',{reason:'撤销早期原图批次，应保留后续共享支持',expected_version:firstCurrent.version})).status,200);
  assert.equal((await env.db.query('SELECT validity FROM metric_observations WHERE id=$1',[observation.id])).rows[0].validity,'confirmed');
  assert.equal((await c.call('/imports/'+duplicate.data.id+'/revert','POST',{reason:'撤销最后有效支持，保留审计原件',expected_version:second.data.version})).status,200);
  assert.equal((await env.db.query('SELECT validity FROM metric_observations WHERE id=$1',[observation.id])).rows[0].validity,'reverted');
  const provenance=await c.call('/metrics/'+observation.id+'/sources');assert.equal(provenance.status,200);assert.equal(provenance.data.evidence.length,2);assert.ok(provenance.data.evidence.every((e:any)=>!e.active));
  report.checks.push({kind,source_sha256:original.sha256,ocr_state:info.metadata.ocr.state,ocr_engine:info.metadata.ocr.engine,proposed_rows:rows.length,recognized_value:chosen.raw.value??null,confidence:chosen.raw.ocr.confidence,manual_verified_value:value,source_region:region,observed_at:at.toISOString(),raw_preserved:true,original_download_hash_preserved:true,confirmed_only_after_manual_review:true,duplicate_one_observation_two_sources:true,early_revert_preserves_shared_value:true,final_revert_preserves_original_history:true});
 }
 report.result='passed_partial_two_real_screenshots_verified_identity';writeFileSync('docs/evidence/s7-ocr/real-input-identity.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:report.checks.length,result:report.result,verified_platform_identity:true,complete_real_account_integration:false,video:'missing',credentials_printed:false}));
}finally{store.destroy();await env.close();}

}
main().catch(()=>{console.error('REAL_OCR_PROBE_FAILED; inspect restricted inputs and sanitized checks');process.exitCode=1;});
