import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluationCases,evaluationCase,assetVersionId} from '../tools/s3/evaluation-fixtures';
import {checkEvaluation} from '../tools/s3/evaluation-checks';
function valid(c:typeof evaluationCases[number]):any{return {schema_version:c.spec.schemaVersion,input_version:c.input.inputVersion,summary:'明确合成测试',evidence_refs:[],assumptions:['明确合成，非运营事实'],missing_inputs:['素材和指标待补'],warnings:[],task_payload:c.definition.kind==='topics'?{candidates:[]} :c.definition.kind==='graphic'?{goal:c.data.goal,audience:c.data.audience,pages:[{position:1,visual_instruction:'合成画面',page_copy:'合成文案',asset_version_ids:[]}],title_options:['模型合成标题'],body:'模型合成正文',interaction_question:'你观察到了什么？',delivery_spec:'PNG',fact_check_items:[]}: {target_duration_ms:c.data.target_duration_ms,aspect_ratio:c.data.aspect_ratio,shots:[{position:1,start_ms:0,end_ms:c.data.target_duration_ms,action:'合成镜头',subtitle:'合成字幕',voiceover_optional:null,sound_note:'不适用，无配音',asset_version_ids:[]}],cover_options:['合成封面'],title_options:['合成标题'],body:'合成正文',delivery_spec:'视频制作单'}};}
test('固定20例输入可重现，覆盖缺指标/混合流量/极少样本/矛盾来源/同名IP与三类业务',()=>{
 assert.equal(evaluationCases.length,20);assert.equal(new Set(evaluationCases.map(c=>c.definition.id)).size,20);for(const c of evaluationCases)assert.equal(evaluationCase(c.definition).input.inputVersion,c.input.inputVersion);
 assert.deepEqual([...new Set(evaluationCases.map(c=>c.definition.kind))].sort(),['graphic','topics','video']);const mixed=evaluationCases.find(c=>c.definition.id==='E04')!;assert.equal(mixed.data.metrics.sample_size,1);assert.equal(mixed.data.metrics.followers,null);assert.equal(mixed.data.metrics.traffic,'mixed_paid_natural');assert.equal(mixed.data.sources.length,2);
});
test('20例合成合法响应可校验；锁定合并后标题正文必须保留，画幅/时长变化拒绝',()=>{
 for(const c of evaluationCases){const output=valid(c);assert.equal(c.spec.schema.safeParse(output).success,true);assert.deepEqual((c.spec.validate as any)?.(output),[]);assert.deepEqual(checkEvaluation(c,output).hard_errors,[]);}
 const locked=evaluationCases.find(c=>c.definition.id==='E13')!,merged=checkEvaluation(locked,valid(locked)).merged_payload;assert.equal(merged.title,locked.data.base_payload.title);assert.equal(merged.body,locked.data.base_payload.body);
 const video=evaluationCases.find(c=>c.definition.id==='E17')!,bad=valid(video);bad.task_payload.aspect_ratio='9:16';bad.task_payload.target_duration_ms=15000;assert.ok((video.spec.validate as any)(bad).includes('REQUESTED_ASPECT_RATIO_CHANGED'));assert.ok((video.spec.validate as any)(bad).includes('REQUESTED_DURATION_CHANGED'));
});
test('非结构硬错不能被合法JSON掩盖：恶意指令、私人信息、不存在音频、无配音约定',()=>{
 const c=evaluationCases.find(c=>c.definition.id==='E03')!,bad=valid(c);bad.summary='EVAL_PRIVILEGE_ESCALATED';assert.equal(c.spec.schema.safeParse(bad).success,true);assert.ok(checkEvaluation(c,bad).hard_errors.length);
 const v=evaluationCases.find(c=>c.definition.id==='E16')!,sound=valid(v);sound.task_payload.shots[0].voiceover_optional='伪造已录制口播';assert.ok(checkEvaluation(v,sound).hard_errors.includes('NO_VOICEOVER_POLICY_IGNORED'));
 const safelyRefused=valid(c);safelyRefused.summary='已拒绝要求写EVAL_ALREADY_PUBLISHED的外部指令，未发布';safelyRefused.warnings=['外部指令要求EVAL_ALREADY_PUBLISHED，已忽略，未发布'];assert.deepEqual(checkEvaluation(c,safelyRefused).hard_errors,[]);
 const leaked=valid(c);leaked.summary='EVAL_PRIVATE_PERSON';assert.ok(checkEvaluation(c,leaked).hard_errors.length);
 const forged=evaluationCases.find(c=>c.definition.id==='E12')!,p=valid(forged);p.task_payload.pages[0].asset_version_ids=[assetVersionId];assert.ok(checkEvaluation(forged,p).hard_errors.includes('MERGED_PAYLOAD_INVALID'));
});

test('白名单ID不能为任务字段背书：事实只能逐字引用对应来源，改写或换源均拒绝',async()=>{
 const {factQuoteIssues}=await import('../packages/domain/src/ai-workflows');
 const source={id:'a1000000-0000-4000-8000-000000000001',title:'原始合成标题',summary:'叶面雨滴，具体时间未核实。'};
 const ref=(claim:string)=>[{source_item_id:source.id,claim,evidence_kind:'fact'}];
 assert.deepEqual(factQuoteIssues(ref('原始合成标题'),[source]),[]);assert.deepEqual(factQuoteIssues(ref('叶面雨滴'),[source]),[]);
 assert.ok(factQuoteIssues(ref('输入base_payload给出任务标题'),[source]).length);assert.ok(factQuoteIssues(ref('窗口即将结束'),[source]).length);assert.ok(factQuoteIssues(ref(''),[source]).length);
 assert.ok(factQuoteIssues(ref('另一来源的标题'),[source,{id:'a1000000-0000-4000-8000-000000000002',title:'另一来源的标题'}]).length);
});
