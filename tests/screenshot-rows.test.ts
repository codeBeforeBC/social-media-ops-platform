import {test} from 'node:test';
import assert from 'node:assert/strict';
import {screenshotRows,sourceRegion,reviewedRegion} from '../packages/domain/src/screenshot-imports';
const word=(text:string,x:number,y:number,confidence=.9,width=40)=>({text,confidence,region:{x,y,width,height:20}});
const metadata=(words:any[])=>({width:1000,height:500,ocr_parser_version:'ocr-v1',ocr:{state:'ready',engine:'synthetic_word_geometry',blocks:[{words}]}});
test('词区域匹配数值保留万与置信，观看不猜形式，所有OCR行强制待核对',()=>{
 const m=metadata([word('545',10,30,.82),word('粉丝数',60,30,.95,70),word('获赞与收藏',150,100,.91,120),word('1.2',150,130),word('万',195,130,.7,20),word('观看数',400,200,.98,80),word('25052',400,230)]);
 const rows=screenshotRows('synthetic-account','synthetic-file',m);assert.equal(rows.length,3);
 assert.equal(rows[0]!.raw.value,'545');assert.equal(rows[0]!.raw.ocr.confidence,.82);assert.equal(rows[1]!.raw.value,'1.2万');assert.equal(rows[1]!.raw.ocr.confidence,.7);
 assert.equal(rows[2]!.raw.metric_key,'');assert.ok(rows.every(r=>r.needs_review));assert.equal(rows[0]!.raw.observed_at,undefined);assert.equal(rows[0]!.raw.platform_note_id,undefined);
});
test('等距候选不猜数值，无字段/失败保留补录入口，区域/伪造置信拒绝',()=>{
 const rows=screenshotRows('account','file',metadata([word('点赞数',100,50,.9,80),word('1',50,50,.9,40),word('2',190,50,.9,40)]));assert.equal(rows[0]!.raw.value,'');
 const empty=screenshotRows('account','file',{...metadata([]),ocr:{state:'failed',blocks:[]}});assert.equal(empty[0]!.raw.ocr.placeholder,true);assert.equal(empty[0]!.raw.value,'');
 assert.throws(()=>sourceRegion({x:999,y:0,width:2,height:1},1000,500));assert.throws(()=>sourceRegion({x:-1,y:0,width:1,height:1},1000,500));
 assert.throws(()=>screenshotRows('account','file',metadata([word('粉丝数',0,0,2)])));
 const r={raw:{ocr:{region:{x:0}}},corrections:[{source_region:{x:3}},{reason:'不换区域'}]};assert.deepEqual(reviewedRegion(r),{x:3});
});
