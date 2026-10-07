/** Controlled Chrome DOM fixtures: no website reads or real page mutations. */
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {classifyDetailMedia} from './xhs-detail-media.mjs';
import {prepareNavigation} from './probe-xhs-navigation.mjs';

const cases=[
  {name:'live photo inside an image carousel',html:'<div class="media-container"><div class="note-slider"><div class="swiper-slide swiper-slide-active"><div class="img-container"><div class="note-slider-img"><img></div><div class="live-photo-contain"><div class="live-video-wrapper"><video class="live-video live-video-play"></video></div></div></div></div></div></div>',expected:{type:'image',has_live_photo:true}},
  {name:'ordinary image carousel',html:'<div class="media-container"><div class="note-slider"><div class="img-container"><img></div></div></div>',expected:{type:'image',has_live_photo:false}},
  {name:'standalone video with poster image',html:'<div class="media-container"><div class="video-player"><video></video><img class="poster"></div></div>',expected:{type:'video',has_live_photo:false}},
  {name:'avatar alone is not note media',html:'<div class="author-wrapper"><img class="avatar-item"></div>',expected:{type:'unknown',has_live_photo:false}},
  {name:'video outside main media does not change image type',html:'<div class="media-container"><div class="note-slider"><div class="img-container"><img></div></div></div><aside class="recommendations"><video></video></aside>',expected:{type:'image',has_live_photo:false}},
  {name:'conflicting primary structures remain unknown',html:'<div class="media-container"><div class="note-slider"><div class="img-container"><img></div></div><div class="video-player"><video></video></div></div>',expected:{type:'unknown',has_live_photo:false}},
  {name:'loading or absent media remains unknown',html:'<div class="media-container"><div class="loading"></div></div>',expected:{type:'unknown',has_live_photo:false}},
];

async function main(){
  const args=process.argv.slice(2),opts={};
  for(let i=0;i<args.length;i+=2){if(!['--opencli-root','--profile','--output'].includes(args[i])||!args[i+1])throw new Error('Use --opencli-root DIR --profile ID --output FILE');opts[args[i].slice(2)]=args[i+1];}
  if(!opts['opencli-root']||!opts.profile||!opts.output)throw new Error('Missing required argument');
  const {Page}=await import(pathToFileURL(path.join(path.resolve(opts['opencli-root']),'dist/src/browser/page.js')).href);
  const page=new Page('yoyo-media-fixtures',60,opts.profile,'background','browser');
  const report={at:new Date().toISOString(),profile:opts.profile,scope:'Controlled detached DOM fixtures; not live source success'};
  try{
    await prepareNavigation(page);
    report.cases=await page.evaluate(`(() => {
      const classify=${classifyDetailMedia.toString()};
      return ${JSON.stringify(cases)}.map(c=>{
        const doc=new DOMParser().parseFromString('<div id="noteContainer">'+c.html+'</div>','text/html');
        const actual=classify(doc.querySelector('#noteContainer'));
        return {name:c.name,expected:c.expected,actual,pass:actual.type===c.expected.type&&actual.has_live_photo===c.expected.has_live_photo};
      });
    })()`);
    report.pass=report.cases.every(c=>c.pass);
    if(!report.pass)process.exitCode=1;
  }finally{await page.closeWindow();await writeFile(path.resolve(opts.output),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report,null,2));}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
