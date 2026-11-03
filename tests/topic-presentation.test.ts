import {test} from 'node:test';
import assert from 'node:assert/strict';
import {topicPresentation} from '../packages/domain/src/topic-presentation';
const topic=():any=>({id:'topic',workspace_id:'workspace',account_id:'account',generation_request_id:'generation',candidate:{estimated_hours:null,assumptions:['读者需求仍是假设']},missing_inputs:['制作工时待估'],warnings:[]});
const request=():any=>({id:'generation',workspace_id:'workspace',account_id:'account',created_at:'2026-10-30T01:00:00Z',snapshot:{scope_version:'v1.2',account:{name:'合成账号'},sources:[{id:'source',title:'合成标题',summary:''}],strategies:[]},result:{missing_inputs:[],warnings:[]}});
test('exact shared explanations move once, unknown warnings remain and raw data is unchanged',()=>{
 const t=topic(),r=request(),notes=['来源正文与摘要缺失：热榜条目仅有标题，无法核对事实细节、发布主体与语境。','真实工时样本（actual_work_hours）缺失，无法给出单条候选的工时估算。','受众画像与需求数据缺失，无法验证候选与真实读者关注点的匹配度。','账号"合成账号"的历史内容与表达样本缺失，YOYO表达契合度无法用样本比对。','阅读、互动、涨粉等指标与归因数据缺失，评分不构成效果预测。','已人工激活的编辑策略（strategies）为空，缺少可对齐的策略依据。'];
 r.result.missing_inputs=notes;t.missing_inputs=[...notes,'制作工时待估','必须核验原始采访授权'];t.warnings=['需核验具体引文','需核验具体引文'];const before=JSON.stringify({t,r});
 const d=topicPresentation(t,r,[{source_item_id:'source',evidence_kind:'fact'},{source_item_id:'source',evidence_kind:'inference'},{source_item_id:null,evidence_kind:'original_hypothesis'}]);
 assert.equal(d.generation.complete,true);assert.equal(d.generation.limitations.length,6);assert.equal(d.presentation.reference_source_count,1);assert.equal(d.presentation.source_review,'title_only');assert.deepEqual(d.presentation.checks,['必须核验原始采访授权','需核验具体引文']);assert.equal(JSON.stringify({t,r}),before);assert.ok(!JSON.stringify(d).includes('actual_work_hours'));
});
test('source warning is based only on this topic frozen fact references; inference is not a fact',()=>{
 const r=request();r.snapshot.sources.push({id:'full',title:'另一来源',summary:'完整合成摘要'});
 assert.equal(topicPresentation(topic(),r,[{source_item_id:'full',evidence_kind:'fact'}]).presentation.source_review,null);
 assert.equal(topicPresentation(topic(),r,[{source_item_id:'source',evidence_kind:'inference'}]).presentation.source_review,null);
 assert.equal(topicPresentation(topic(),r,[{source_item_id:'missing',evidence_kind:'fact'}]).presentation.source_review,'unavailable');
 assert.equal(topicPresentation(topic(),r,[]).presentation.reference_source_count,0);
 assert.equal(topicPresentation(topic(),r,[{source_item_id:'missing',evidence_kind:'fact'},{source_item_id:'source',evidence_kind:'fact'}]).presentation.source_review,'unavailable');
});
test('missing or cross-account generation keeps unknown checks without leaking context or inventing completeness',()=>{
 const t=topic();t.missing_inputs.push('actual_work_hours可能不足，还需核实授权');t.warnings.push('不得把这项风险隐藏');
 for(const r of [null,{...request(),account_id:'other',snapshot:{secret:'must-not-leak'}}]){
  const d=topicPresentation(t,r,[]);assert.equal(d.generation.complete,false);assert.equal(d.generation.created_at,null);assert.ok(d.generation.limitations.some(s=>s.includes('历史生成说明不完整')));assert.deepEqual(d.presentation.checks,['实际制作工时可能不足，还需核实授权','不得把这项风险隐藏']);assert.ok(!JSON.stringify(d).includes('must-not-leak'));
 }
});
test('inconsistent or longer notes are not swallowed by matching a known keyword',()=>{
 const t=topic(),r=request();const note='真实工时样本（actual_work_hours）缺失，无法给出单条候选的工时估算。另须核对版权。';r.result.missing_inputs=[note];t.missing_inputs=[note];
 assert.equal(topicPresentation(t,r,[]).presentation.checks.length,1);
 r.snapshot.sources=[{id:'source',title:'完整',summary:'已提供摘要'}];const wrong='来源正文与摘要缺失：热榜条目仅有标题，无法核对事实细节、发布主体与语境。';r.result.missing_inputs=[wrong];t.missing_inputs=[wrong];assert.deepEqual(topicPresentation(t,r,[]).presentation.checks,[wrong]);
});

test('retired requirements do not return, while actual content/rights risks remain visible',()=>{
 const t=topic(),r=request();t.missing_inputs=['排期日历配置缺失','审核流程未配置','制作工时待估','素材授权证明缺失'];t.warnings=['需要核实素材授权风险','活动声明的真实性需要核实'];const d=topicPresentation(t,r,[]);assert.deepEqual(d.presentation.checks,['素材授权证明缺失',...t.warnings]);
});

test('empty input objects are not claimed as data; complete inputs and variants share stable batch notes',()=>{
 const t=topic(),r=request();Object.assign(r.snapshot,{audience_profile:{},account_history:[],metrics:{},actual_work_hours:[],strategies:{}});let d=topicPresentation(t,r,[]);assert.ok(d.generation.limitations.includes('本次未参考读者画像或需求资料。'));assert.ok(!d.generation.inputs.includes('读者画像资料。'));assert.ok(!d.generation.inputs.some(s=>s.includes('undefined')));
 Object.assign(r.snapshot,{sources:[{id:'source',title:'合成标题',summary:'合成完整摘要'}],audience_profile:{description:'合成'},account_history:[{title:'合成'}],metrics:[{value:'1'}],actual_work_hours:[{hours:1}],strategies:[{action:'合成经验'}],capacity_hours:0});d=topicPresentation(t,r,[]);assert.deepEqual(d.generation.limitations,[]);assert.ok(!d.generation.inputs.some(s=>s.includes('可用工时')));assert.deepEqual(topicPresentation({...t,candidate:{...t.candidate,estimated_hours:2}},r,[]).generation,d.generation);
});

test('unreadable legacy source/result entries fall back without crashing or hiding unknown checks',()=>{
 for(const mode of ['null-source','missing-source-title','invalid-result']){const t=topic(),r=request();t.missing_inputs=['必须核对的未知事项'];if(mode==='null-source')r.snapshot.sources=[null];else if(mode==='missing-source-title')r.snapshot.sources=[{id:'source'}];else r.result.missing_inputs=[null];const d=topicPresentation(t,r,[{source_item_id:mode==='missing-source-title'?'source':'missing',evidence_kind:'fact'}]);assert.equal(d.generation.complete,false);assert.deepEqual(d.presentation.checks,['必须核对的未知事项']);assert.equal(d.presentation.source_review,'unavailable');}
});
