import type {TopicGenerationSummary,TopicPresentation} from '../../contracts/src/types';

type Evidence={source_item_id:string|null;evidence_kind:string};
const workPending='制作工时待估';
const workExplanation='本次未参考实际制作耗时，暂不提供可靠的制作时间估算。';
const unique=(items:string[])=>[...new Set(items)];
const strings=(value:unknown):string[]=>Array.isArray(value)?value.filter((s):s is string=>typeof s==='string'&&!!s.trim()):[];
const hasData=(value:unknown)=>Array.isArray(value)?value.length>0:typeof value==='string'?!!value.trim():value!==null&&typeof value==='object'?Object.keys(value).length>0:false;
// Retired input requirements are distinct from warnings about real content or permissions.
export function visibleTopicMissingInputs(value:unknown){return strings(value).filter(text=>! /^(?:(?:素材库|素材|品牌规范|生效规范|审核流程|制作单|发布权限|排期日历|活动模块|base_payload)(?:配置)?(?:缺失|未配置|为空|待补齐?)|(?:缺少|待补齐?|需要补齐)(?:素材库|素材|品牌规范|生效规范|审核流程|制作单|发布权限|排期日历|活动模块|base_payload))[。.!！]?$/.test(text.trim()));}
export function readableTopicNote(text:string){return text.replace(/[（(]\s*(?:actual_work_hours|strategies)\s*[）)]/g,'').replace(/\bactual_work_hours\b/g,'实际制作工时').replace(/\bstrategies\b/g,'运营经验').trim();}
const normalize=(text:string)=>readableTopicNote(text).normalize('NFC').replace(/\s+/g,' ');
function knownLimitations(snapshot:any){
 const sources=Array.isArray(snapshot?.sources)?snapshot.sources:[];
 const titleOnly=sources.filter((s:any)=>typeof s.summary!=='string'||!s.summary.trim()).length;
 return [
  {enabled:titleOnly>0,label:titleOnly===sources.length?'本次来源仅提供标题，涉及事实时需核对原文。':'本次部分来源仅提供标题，涉及事实时需核对原文。',aliases:['来源正文与摘要缺失：热榜条目仅有标题，无法核对事实细节、发布主体与语境。']},
  {enabled:!hasData(snapshot?.actual_work_hours),label:workExplanation,aliases:['真实工时样本（actual_work_hours）缺失，无法给出单条候选的工时估算。',workPending]},
  {enabled:!hasData(snapshot?.audience_profile),label:'本次未参考读者画像或需求资料。',aliases:['受众画像与需求数据缺失，无法验证候选与真实读者关注点的匹配度。']},
  {enabled:!hasData(snapshot?.account_history),label:'本次未参考账号历史内容与表达样本。',aliases:[`账号"${snapshot?.account?.name}"的历史内容与表达样本缺失，YOYO表达契合度无法用样本比对。`,`账号“${snapshot?.account?.name}”的历史内容与表达样本缺失，YOYO表达契合度无法用样本比对。`]},
  {enabled:!hasData(snapshot?.metrics),label:'本次评分未参考历史效果数据。',aliases:['阅读、互动、涨粉等指标与归因数据缺失，评分不构成效果预测。']},
  {enabled:!Array.isArray(snapshot?.strategies)||snapshot.strategies.length===0,label:'本次未使用已启用的运营经验。',aliases:['已人工激活的编辑策略（strategies）为空，缺少可对齐的策略依据。']}
 ].filter(x=>x.enabled);
}
export function topicPresentation(topic:any,request:any|null,evidence:Evidence[]):{generation:TopicGenerationSummary;presentation:TopicPresentation}{
 const valid=request?.id===topic.generation_request_id&&request?.account_id===topic.account_id&&request?.workspace_id===topic.workspace_id;
 const snapshot=valid?request.snapshot:null,result=valid?request.result:null;
 const complete=!!(snapshot?.scope_version==='v1.2'&&Array.isArray(snapshot.sources)&&snapshot.sources.every((s:any)=>s&&typeof s.id==='string'&&typeof s.title==='string')&&Array.isArray(result?.missing_inputs)&&result.missing_inputs.every((s:unknown)=>typeof s==='string')&&Array.isArray(result?.warnings)&&result.warnings.every((s:unknown)=>typeof s==='string'));
 const known=complete?knownLimitations(snapshot):[];
 const shared=new Set([...strings(result?.missing_inputs),...strings(result?.warnings)].map(normalize));
 const explained=new Set(known.flatMap(x=>x.aliases).map(normalize).filter(s=>shared.has(s)));
 const limitations=complete?known.map(x=>x.label):['历史生成说明不完整；本题保留已有核验事项。','历史制作时间估算的依据不可确认，请自行判断。'];
 // Only exact known explanations with matching frozen context move out of the risk list.
 const checks=unique([...visibleTopicMissingInputs(topic.missing_inputs),...strings(topic.warnings)].filter(s=>s!==workPending&&!explained.has(normalize(s))).map(readableTopicNote).filter(Boolean));
 const assumptions=unique(strings(topic.candidate?.assumptions).map(readableTopicNote).filter(s=>!!s&&!checks.includes(s)));
 const inputs:string[]=[];
 if(complete){
  const sources=snapshot.sources,withSummary=sources.filter((s:any)=>typeof s.summary==='string'&&!!s.summary.trim()).length;
  inputs.push(sources.length?`参考线索 ${sources.length} 条，其中 ${withSummary} 条含摘要。`:'本次未引用外部来源。');
  if(strings(snapshot.columns).length)inputs.push('选题栏目：'+strings(snapshot.columns).join('、'));
  if(Array.isArray(snapshot.strategies)&&snapshot.strategies.length)inputs.push(`已启用的运营经验 ${snapshot.strategies.length} 项。`);
  if(hasData(snapshot.audience_profile))inputs.push('读者画像资料。');
  if(hasData(snapshot.account_history))inputs.push('账号历史内容与表达样本。');
  if(hasData(snapshot.metrics))inputs.push('历史效果数据。');
  if(hasData(snapshot.actual_work_hours))inputs.push('实际制作耗时样本。');
 }
 const sourceIds=unique(evidence.map(e=>e.source_item_id).filter((s):s is string=>!!s));
 const facts=unique(evidence.filter(e=>e.evidence_kind==='fact'&&e.source_item_id).map(e=>e.source_item_id!));
 let sourceReview:TopicPresentation['source_review']=null;
 for(const id of facts){const source=Array.isArray(snapshot?.sources)?snapshot.sources.find((s:any)=>s&&s.id===id):null;
  if(!source||typeof source.title!=='string'){sourceReview='unavailable';}
  else if((typeof source.summary!=='string'||!source.summary.trim())&&sourceReview!=='unavailable')sourceReview='title_only';
 }
 return {generation:{id:topic.generation_request_id,created_at:valid&&request.created_at?new Date(request.created_at).toISOString():null,complete,inputs,limitations:unique(limitations)},presentation:{reference_source_count:sourceIds.length,source_review:sourceReview,checks,assumptions}};
}
