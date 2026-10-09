/** Select one public author from actual travel search; then exercise the product collector. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {prepareNavigation} from '../s0/probe-xhs-navigation.mjs';
import {referenceAccountId} from './xhs-reference.mjs';
import {collectXhs,failureCode} from './xhs-collector.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const root=resolve('.local/providers/opencli/node_modules/@jackwener/opencli');
const {Page}=await import(pathToFileURL(join(root,'dist/src/browser/page.js')).href);
const {command:search}=await import(pathToFileURL(join(root,'clis/xiaohongshu/search.js')).href);
const profile='zrcmcu2d',report={started_at:new Date().toISOString(),actual_source:true,selection:'first readable public author from travel search; technical reference, not quality endorsement',results:[]};
const page=new Page(`yoyo-reference-probe:${randomUUID()}`,60,profile,'background','adapter','ephemeral');
try{
 await prepareNavigation(page);
 const rows=await search.func(page,{query:'旅行',limit:2,sort:'comprehensive','note-type':'all','publish-time':'anytime',scope:'all',location:'all'});
 const url=new URL(rows[0]?.author_url);url.search='';url.hash='';
 const account=referenceAccountId(url.toString());
 await mkdir('.local/source-probes',{recursive:true});
 await writeFile('.local/source-probes/reference-config.json',JSON.stringify({profile,keywords:['旅行'],reference_accounts:[account],max_items:4}),{mode:0o600});
 await page.closeWindow();await new Promise(r=>setTimeout(r,2500));
 const result=await collectXhs({source_type:'xhs_quality_note',config:{profile,keywords:['旅行'],reference_accounts:[account],max_items:4}});
 report.results.push({state:'succeeded',adapter_version:result.adapter_version,coverage:{...result.coverage,reference_accounts:result.coverage.reference_accounts.map(a=>({...a,account_id:undefined,account_id_sha256:hash(a.account_id)}))},warnings:result.warnings,items:result.items.map(i=>({external_id:i.external_id,title_sha256:hash(i.title),actual_source_type:i.actual_source_type,author_present:Boolean(i.author),published_at:i.published_at,captured_at:i.captured_at,summary_chars:i.summary.length,media_type:i.media_type,visible_counts:i.visible_counts,reference_only:i.reference_only}))});
 if(!result.items.some(i=>i.actual_source_type==='account_feed'))process.exitCode=1;
}catch(e){report.results.push({state:'failed',error_code:failureCode(e)});process.exitCode=1;}
finally{await page.closeWindow().catch(()=>{});report.finished_at=new Date().toISOString();await writeFile('docs/evidence/s3/reference-account-live-probe.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({state:report.results[0]?.state,account_feed_items:report.results[0]?.items?.filter(i=>i.actual_source_type==='account_feed').length??0}));}
