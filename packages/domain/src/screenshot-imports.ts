import {z} from 'zod';
import {AppError,parse} from './protocol';
export const sourceRegionSchema=z.object({x:z.number().finite().nonnegative(),y:z.number().finite().nonnegative(),width:z.number().finite().positive(),height:z.number().finite().positive()}).strict();
export function sourceRegion(input:unknown,width:number,height:number){const r=parse(sourceRegionSchema,input);if(!Number.isFinite(width)||!Number.isFinite(height)||r.x+r.width>width||r.y+r.height>height)throw new AppError(422,'OCR_REGION_INVALID','区域超出原图范围');return r;}
export function reviewedRegion(row:any){return [...row.corrections].reverse().find(c=>c.source_region)?.source_region??row.raw?.ocr?.region??null;}
const labels:[string,string[]][]=[['likes_saves_combined',['获赞与收藏','获赞和收藏']],['followers',['粉丝总数','粉丝数','粉丝','Followers']],['new_followers',['新增关注']],['unfollows',['取消关注','取关']],['impressions',['曝光数']],['likes',['点赞数']],['saves',['收藏数']],['comments',['评论数']],['shares',['分享数']],['attributed_follows',['涨粉数']],['completion_rate',['完播率']],['average_watch_seconds',['平均观看时长']],['',['观看数','阅读数','播放数']]];
export function screenshotRows(account:string,fileId:string,metadata:any){
 const image=metadata.ocr,dimensions={width:metadata.width,height:metadata.height};
 if(metadata.ocr_parser_version!=='ocr-v1'||!image||!Array.isArray(image.blocks)||image.blocks.length>5000)throw new Error('OCR_METADATA_INVALID');
 const words:{text:string;confidence:number;region:z.infer<typeof sourceRegionSchema>}[]=[];
 for(const block of image.blocks){
  for(const word of block.words??[block]){
   if(typeof word.text!=='string'||word.text.length>2000||!Number.isFinite(word.confidence)||word.confidence<0||word.confidence>1)throw new Error('OCR_METADATA_INVALID');
   words.push({...word,region:sourceRegion(word.region,dimensions.width,dimensions.height)});
  }
 }
 if(words.length>5000)throw new Error('OCR_METADATA_INVALID');
 const union=(a:z.infer<typeof sourceRegionSchema>,b:z.infer<typeof sourceRegionSchema>)=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.max(a.x+a.width,b.x+b.width)-Math.min(a.x,b.x),height:Math.max(a.y+a.height,b.y+b.height)-Math.min(a.y,b.y)});
 const numbers=words.flatMap((w,i)=>{
  if(!/^-?\d+(?:\.\d+)?\s*(?:万|%|千|亿|K)?$/i.test(w.text))return [];
  const next=words[i+1],gap=next?next.region.x-(w.region.x+w.region.width):Infinity;
  if(next&&/^(万|%|千|亿|K)$/i.test(next.text)&&gap>=0&&gap<w.region.height*2&&Math.abs(next.region.y-w.region.y)<w.region.height)return [{text:w.text+next.text,confidence:Math.min(w.confidence,next.confidence),region:union(w.region,next.region)}];
  return [w];
 });
 const rows:{raw:any;file_id:string;needs_review:true}[]=[];
 for(const block of image.blocks){
  const parts=block.words??[block];
  for(let start=0;start<parts.length;start++){
   let match:{key:string;end:number;text:string;region:z.infer<typeof sourceRegionSchema>;confidence:number}|undefined;
   for(let end=start;end<Math.min(parts.length,start+10);end++){
    const text=parts.slice(start,end+1).map((w:any)=>w.text).join('').replace(/\s+/g,'');
    const label=labels.find(([,aliases])=>aliases.some(alias=>text.toLowerCase()===alias.toLowerCase()));if(!label)continue;
    match={key:label[0],end,text,region:parts.slice(start,end+1).map((w:any)=>w.region).reduce(union),confidence:Math.min(...parts.slice(start,end+1).map((w:any)=>w.confidence))};
   }
   if(!match)continue;
   const label=match,box=label.region;
   const candidates=numbers.map(w=>{
    const r=w.region,overlap=Math.max(0,Math.min(box.y+box.height,r.y+r.height)-Math.max(box.y,r.y));
    const inline=overlap>=Math.min(box.height,r.height)*0.5;
    const gap=Math.max(box.x-(r.x+r.width),r.x-(box.x+box.width),0);
    const below=r.y>=box.y+box.height&&r.y-(box.y+box.height)<dimensions.height*0.08&&Math.abs(r.x-box.x)<dimensions.width*0.03;
    return {word:w,distance:inline&&gap<dimensions.width*0.06?gap:below?r.y-(box.y+box.height)+Math.abs(r.x-box.x):Infinity};
   }).filter(c=>Number.isFinite(c.distance)).sort((a,b)=>a.distance-b.distance);
   const value=candidates[0]&&(!candidates[1]||candidates[1].distance-candidates[0].distance>10)?candidates[0].word:null;
   const region=value?union(box,value.region):box;
   rows.push({file_id:fileId,needs_review:true,raw:{account_id:account,metric_key:label.key,value:value?.text??'',ocr:{text:label.text+(value?' '+value.text:''),confidence:Math.min(label.confidence,value?.confidence??0),region,dimensions,engine:image.engine,placeholder:false,ambiguous_value:!value}}});
   start=label.end;
  }
 }
 if(!rows.length)rows.push({file_id:fileId,needs_review:true,raw:{account_id:account,value:'',ocr:{text:'',confidence:0,region:{x:0,y:0,width:dimensions.width,height:dimensions.height},dimensions,placeholder:true,state:image.state}}});
 return rows;
}
