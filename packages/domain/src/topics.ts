import {Database,Tx} from '../../db/src/db';
import {topicOutputSchema,scoreCandidate,factQuoteIssues} from './ai-workflows';
import {id,AppError} from './protocol';
/** The output and its evidence are persisted only inside the Job's guarded completion transaction. */
export async function saveTopics(tx:Tx,request:any,output:unknown){
 const result=topicOutputSchema.parse(output);
 if(result.input_version!==request.input_version)throw new Error('TOPIC_INPUT_VERSION_MISMATCH');
 const sourceIds=request.snapshot.sources.map((s:any)=>s.id);
 if(result.evidence_refs.some(id=>!sourceIds.includes(id)))throw new Error('TOPIC_EVIDENCE_NOT_ALLOWED');
 for(const [position,candidate] of result.task_payload.candidates.entries()){
  if(factQuoteIssues(candidate.evidence_refs,request.snapshot.sources).length)throw new AppError(422,'FACT_QUOTE_NOT_IN_SOURCE','事实引用必须是冻结来源的原文片段');
  const expiryDates=[...(candidate.expires_at?[Date.parse(candidate.expires_at)]:[]),...candidate.evidence_refs.flatMap(e=>{const source=request.snapshot.sources.find((s:any)=>s.id===e.source_item_id);return source&&source.pipeline_type!=='xhs_quality_note'?[new Date(source.captured_at).getTime()+86400000]:[]})];
  const expiresAt=expiryDates.length?new Date(Math.min(...expiryDates)).toISOString():null;
  const missingInputs=[...new Set([...result.missing_inputs,...(candidate.estimated_hours===null?['制作工时待估']:[])])];
  const warnings=[...new Set([...result.warnings,...(request.snapshot.warnings??[])])];
  const topicId=id();const inserted=await tx.query(`INSERT INTO topics(id,workspace_id,account_id,created_by,generation_request_id,candidate_position,candidate,score,missing_inputs,warnings,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(generation_request_id,candidate_position) DO NOTHING RETURNING id`,[topicId,request.workspace_id,request.account_id,request.created_by,request.id,position+1,JSON.stringify(candidate),scoreCandidate(candidate),missingInputs,warnings,expiresAt]);
  if(!inserted.rowCount)continue;
  for(const evidence of candidate.evidence_refs){
   const source=request.snapshot.sources.find((s:any)=>s.id===evidence.source_item_id);
   if(evidence.source_item_id&&!source)throw new Error('TOPIC_EVIDENCE_NOT_ALLOWED');
   await tx.query('INSERT INTO topic_evidence(workspace_id,topic_id,source_item_id,observation_id,claim,evidence_kind) VALUES($1,$2,$3,$4,$5,$6)',[request.workspace_id,topicId,evidence.source_item_id,source?.observation_id??null,evidence.claim,evidence.evidence_kind]);
  }
 }
}
