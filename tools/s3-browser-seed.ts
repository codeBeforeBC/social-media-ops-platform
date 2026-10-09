/** Explicit synthetic browser fixture in the isolated test database. */
import {database} from '../tests/helpers';
import {saveSourceItems} from '../packages/domain/src/source-evidence';
async function main(){
 const db=await database();
 try{const c=(await db.query("SELECT * FROM source_connections WHERE name='浏览器采集连接'")).rows[0];const run=(await db.query("INSERT INTO collection_runs(workspace_id,connection_id,created_by,connection_version,trigger,state) VALUES($1,$2,$3,$4,'manual','succeeded') RETURNING id",[c.workspace_id,c.id,c.owner_id,c.version])).rows[0];await db.transaction(tx=>saveSourceItems(tx,c,run.id,{items:[{external_id:'browser-source-test',canonical_url:'https://s.weibo.com/weibo?q=controlled',title:'明确合成的浏览器证据线索',summary:'这是页面验收夹具，不是真实平台采集。',author:null,published_at:null,date_label_raw:null,captured_at:new Date().toISOString(),actual_source_type:'official_rank',media_type:'unknown',visible_counts:{heat:{raw:'123',value:123,approximate:false}},rank:1,reference_only:true}],coverage:{test_only:true},adapter_version:'browser-controlled'}));}finally{await db.close();}

}
main().catch(()=>{console.error('SOURCE_BROWSER_FIXTURE_FAILED');process.exitCode=1;});
