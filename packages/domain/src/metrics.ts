import {Metric} from './imports';
export const calculationVersion='s7-v1';
export type Observation={id:string;metric:Metric;analysis_warning?:string|null};
const scale=1000000n;
function number(value:string){return BigInt(value.replace('.','')+'0'.repeat(6-(value.split('.')[1]??'').length));}
export function roundRatio(n:bigint,d:bigint,places=2){if(d===0n)throw new Error('ZERO_DENOMINATOR');const factor=10n**BigInt(places),sign=(n<0n)!==(d<0n)?'-':'';n=n<0n?-n:n;d=d<0n?-d:d;const rounded=(n*factor*2n+d)/(2n*d);return sign+(rounded/factor).toString()+(places?'.'+(rounded%factor).toString().padStart(places,'0'):'');}
type Measure={value:bigint|null;ids:string[];reason:string|null;approximate:boolean;kind:string};
export function computeMetrics(observations:Observation[],start:string,end:string){
 const groups=new Map<string,Observation[]>();for(const o of observations){const m=o.metric,key=JSON.stringify([m.traffic_type,m.source_definition,m.definition_version,m.time_precision]);if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(o);}
 const output:any[]=[];
 for(const list of groups.values()){
  const base=list[0]!.metric,targets=[...new Set(list.map(o=>o.metric.target.publication_id??null))];
  function measure(rows:Observation[],key:string):Measure{const all=rows.filter(o=>o.metric.metric_key===key);const interval=all.filter(o=>o.metric.aggregation_kind==='interval'&&o.metric.window_start===start&&o.metric.window_end===end);const first=all.filter(o=>o.metric.aggregation_kind!=='interval'&&o.metric.observed_at===start),last=all.filter(o=>o.metric.aggregation_kind!=='interval'&&o.metric.observed_at===end);const inputs=interval.length?interval:[...first,...last];const ids=inputs.map(o=>o.id),approximate=inputs.some(o=>o.metric.is_approximate);let reason:string|null=null,value:bigint|null=null;
   if(all.some(o=>o.analysis_warning))reason=all.find(o=>o.analysis_warning)!.analysis_warning!;else if(!all.length)reason=key==='followers'?'缺期初值：followers':'数据缺失：'+key;else if(interval.length>1||first.length>1||last.length>1||interval.length&&first.length&&last.length)reason='统计类型存在多个可用值，需核对口径';
   else if(inputs.some(o=>o.metric.value===null))reason='输入值缺失：'+inputs.filter(o=>o.metric.value===null).map(o=>o.metric.missing_reason).join('；');
   else if(interval.length===1)value=number(interval[0]!.metric.value!);
   else if(!first.length)reason='缺期初值：'+key;else if(!last.length)reason='缺期末值：'+key;
   else {value=number(last[0]!.metric.value!)-number(first[0]!.metric.value!);if(value<0n&&key!=='followers'){reason='累计值回落，平台修正或删帖待核实';value=null;}}
   return {value,ids,reason,approximate,kind:interval.length?'interval':'boundary_delta'};
  }
  function result(pid:string|null,key:string,inputs:Measure[],n:bigint|null,d:bigint=scale,places=2,reason:string|null=null){let missing=reason??inputs.find(i=>i.reason)?.reason??(n===null?'数据缺失':d===0n?'零分母':null);const value=missing?null:roundRatio(n!,d,places);if(value&&value.replace(/^-/,'').split('.')[0]!.length>18)missing='派生值超出存储范围，需核实输入';output.push({publication_id:pid,metric_key:key,traffic_type:base.traffic_type,source_definition:base.source_definition,time_precision:base.time_precision,definition_version:base.definition_version,window_start:start,window_end:end,calculation_version:calculationVersion,input_observation_ids:[...new Set(inputs.flatMap(i=>i.ids))].sort(),rounding_rule:'half_up:'+places,value:missing?null:value,missing_reason:missing,is_approximate:inputs.some(i=>i.approximate)});}
  for(const pid of targets){const rows=list.filter(o=>(o.metric.target.publication_id??null)===pid);if(pid===null){const followers=measure(rows,'followers');result(null,'net_followers',[followers],followers.value,scale,0);}else{const reads=measure(rows,'reads'),follows=measure(rows,'attributed_follows');result(pid,'follows_per_1000_reads',[reads,follows],follows.value===null?null:follows.value*1000n,reads.value??0n);const interactions=['likes','saves','comments','shares'].map(k=>measure(rows,k));result(pid,'interaction_count_rate',[reads,...interactions],interactions.some(m=>m.value===null)?null:interactions.reduce((sum,m)=>sum+m.value!,0n)*100n,reads.value??0n);
   for(const key of ['impressions','reads','plays','likes','saves','comments','shares','attributed_follows']){if(rows.some(o=>o.metric.metric_key===key&&o.metric.aggregation_kind==='cumulative')){const delta=measure(rows.filter(o=>o.metric.aggregation_kind==='cumulative'),key);result(pid,key+'_interval_delta',[delta],delta.value,scale,0);}}
  }}
  const videos=list.filter(o=>o.metric.metric_key==='average_watch_seconds');if(videos.length){const weights:Measure[]=[],averages:Measure[]=[];for(const pid of new Set(videos.map(o=>o.metric.target.publication_id))){const rows=list.filter(o=>o.metric.target.publication_id===pid);averages.push(measure(rows,'average_watch_seconds'));weights.push(measure(rows,'watch_count'));}const inputs=[...averages,...weights];const numerator=inputs.some(m=>m.value===null)?null:averages.reduce((sum,a,i)=>sum+a.value!*weights[i]!.value!,0n);const denominator=weights.some(w=>w.value===null)?0n:weights.reduce((sum,w)=>sum+w.value!,0n)*scale;result(null,'weighted_average_watch_seconds',inputs,numerator,denominator);}
 }
 return output;
}
