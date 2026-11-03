import React,{useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
import {Drawer,Empty,ErrorState,JobStatus,Loading} from './components';
import {readableTopicNote,visibleTopicMissingInputs} from '../../../packages/domain/src/topic-presentation';
import type {InstanceData,TopicGenerationSummary,TopicPresentation} from '../../../packages/contracts/src/types';
const statuses:Record<string,string>={proposed:'待采纳',accepted:'已采纳',rejected:'已拒绝',expired:'已过期'};
const criteria:Record<string,string>={audience_need:'受众需求',yoyo_expression:'YOYO表达',follow_reason:'连续关注理由',clarity:'内容清楚',feasibility:'制作可行',timing:'时机'};
const weights:Record<string,number>={audience_need:25,yoyo_expression:25,follow_reason:20,clarity:15,feasibility:10,timing:5};
const decisions:Record<string,string>={accepted:'已采纳',rejected:'已拒绝',variant:'创建变体'};
const scoreText=(value:string|number)=>String(value).replace(/(\.\d*?[1-9])0+$|\.0+$/,'$1');
const notes=(values:string[]=[])=>[...new Set(values.map(readableTopicNote).filter(s=>!!s&&s!=='制作工时待估'))];
function displayOf(t:any):TopicPresentation{
 if(t.presentation)return t.presentation;
 const refs=t.evidence??t.candidate.evidence_refs??[],checks=notes([...visibleTopicMissingInputs(t.missing_inputs),...t.warnings]);
 return {reference_source_count:new Set(refs.map((e:any)=>e.source_item_id).filter(Boolean)).size,source_review:refs.some((e:any)=>e.source_item_id&&e.evidence_kind==='fact')?'unavailable':null,checks,assumptions:notes(t.candidate.assumptions).filter(s=>!checks.includes(s))};
}
function legacyGeneration(t:any):TopicGenerationSummary{return {id:t.generation_request_id??'history:'+t.id,created_at:null,complete:false,inputs:[],limitations:['历史生成说明不完整；本题保留已有核验事项。','历史制作时间估算的依据不可确认，请自行判断。']};}
const reviewLabel=(review:TopicPresentation['source_review'])=>review==='title_only'?'需核对原文':review==='unavailable'?'来源信息待核对':'';
function GenerationNotes({generations,accounts=[],label}:{generations:TopicGenerationSummary[];accounts?:{generationId:string;name:string}[];label?:string}){
 if(!generations.length)return null;
 return <details className="topic-generation-notes"><summary><span>{label??(generations.some(g=>!g.complete)?'历史生成说明待核对':'生成参考资料有限')}</span><span className="topic-disclosure-label">{label?'展开说明':'查看生成说明'}</span></summary><div className="topic-generation-body">{generations.map(g=><section key={g.id}><h4>{g.created_at?'生成于 '+new Date(g.created_at).toLocaleString('zh-CN'):'历史生成记录'}{accounts.find(a=>a.generationId===g.id)?.name&&<small>{accounts.find(a=>a.generationId===g.id)!.name}</small>}</h4>{g.inputs.length>0&&<><h5>本批次使用的资料</h5><ul>{g.inputs.map(s=><li key={s}>{s}</li>)}</ul></>}{g.limitations.length>0?<><h5>建议的适用范围</h5><ul>{g.limitations.map(s=><li key={s}>{s}</li>)}</ul></>:<p className="muted">本次未列出资料限制，仍需人工核验选题依据。</p>}</section>)}</div></details>;
}
function initialFilters(workspaceId:string){
 const q=new URLSearchParams(location.hash.split('?')[1]);let saved:any={};try{saved=JSON.parse(sessionStorage.getItem('yoyo-topics:'+workspaceId)??'{}');}catch{}
 const status=q.has('status')?q.get('status'):saved?.status,media=q.has('media_type')?q.get('media_type'):saved?.media;
 return {account:q.has('account_id')?q.get('account_id')!:typeof saved?.account==='string'?saved.account:null,status:status===''||Object.hasOwn(statuses,status??'')?status:'proposed',media:media==='graphic'||media==='video'?media:''};
}
export function TopicsPanel({me}:{me:InstanceData}){
 const [initial]=useState(()=>initialFilters(me.workspace.id));
 const [accounts,setAccounts]=useState<any[]>([]),[accountsReady,setAccountsReady]=useState(false),[accountReload,setAccountReload]=useState(0),[accountError,setAccountError]=useState<Error|null>(null),[account,setAccount]=useState(initial.account??''),[status,setStatus]=useState<string>(initial.status),[media,setMedia]=useState(initial.media),[items,setItems]=useState<any[]>([]),[generations,setGenerations]=useState<TopicGenerationSummary[]>([]),[cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState<any>(null),[error,setError]=useState<Error|null>(null),[listError,setListError]=useState<Error|null>(null),[loading,setLoading]=useState(true),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[request,setRequest]=useState<any>(null),[generating,setGenerating]=useState(false),[action,setAction]=useState<'accept'|'reject'|'variant'|null>(null);
 const canEdit=true;
 const actionRef=useRef<HTMLElement>(null),confirmRef=useRef<HTMLButtonElement>(null),headingRef=useRef<HTMLHeadingElement>(null),detailTrigger=useRef<HTMLButtonElement|null>(null);
 const mounted=useRef(true),listSerial=useRef(0),failedMore=useRef(false),currentFilters=useRef({account,status,media});currentFilters.current={account,status,media};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;listSerial.current++;};},[]);
 useEffect(()=>{if(action)actionRef.current?.scrollIntoView({block:'nearest'});if(action==='accept')confirmRef.current?.focus();},[action]);
 const selectedDisplay=selected?displayOf(selected):null;
 const riskGroups=selectedDisplay?[
  {label:'核对事项',items:selectedDisplay.checks},
  {label:'选题假设',items:selectedDisplay.assumptions}
 ].filter(g=>g.items.length):[];
 const sourceCount=selectedDisplay?.reference_source_count??0;
 const visibleGenerations=[...new Map(items.map(t=>{const key=t.generation_request_id??'history:'+t.id;return [key,generations.find(g=>g.id===key)??legacyGeneration(t)] as const;})).values()];
 const conflict=error instanceof ApiError&&error.status===409;
 const actionUnavailable=action!=='variant'&&selected?.effective_status!=='proposed';
 async function load(more=false){
  const filters={...currentFilters.current},key=JSON.stringify(filters),serial=++listSerial.current;const current=()=>mounted.current&&serial===listSerial.current&&key===JSON.stringify(currentFilters.current);
  setLoading(true);setListError(null);const q=new URLSearchParams();if(filters.account)q.set('account_id',filters.account);if(filters.status)q.set('status',filters.status);if(filters.media)q.set('media_type',filters.media);if(more&&cursor)q.set('cursor',cursor);
  try{const r=await api('/topics?'+q);if(!current())return;setItems(old=>more?[...old,...r.items.filter((t:any)=>!old.some(o=>o.id===t.id))]:r.items);setGenerations(old=>more?[...new Map([...old,...(r.generations??[])].map(g=>[g.id,g])).values()]:r.generations??[]);setCursor(r.next_cursor);setLoaded(true);failedMore.current=false;}
  catch(e){if(current()){failedMore.current=more;setListError(e as Error);}}finally{if(current())setLoading(false);}
 }
 const loadRef=useRef(load);loadRef.current=load;
 useEffect(()=>{let active=true;setAccountError(null);void api('/accounts').then(r=>{if(!active)return;setAccounts(r.items);setAccount(initial.account!==null&&(initial.account===''||r.items.some((a:any)=>a.id===initial.account))?initial.account:r.items[0]?.id??'');setAccountsReady(true);}).catch(e=>{if(active)setAccountError(e as Error);});return()=>{active=false;};},[accountReload]);
 useEffect(()=>{if(!accountsReady)return;setItems([]);setGenerations([]);setCursor(null);setLoaded(false);failedMore.current=false;void load();},[accountsReady,account,status,media]);
 useEffect(()=>{if(!accountsReady)return;try{sessionStorage.setItem('yoyo-topics:'+me.workspace.id,JSON.stringify({account,status,media}));}catch{}
  if(location.hash.split('?')[0]==='#topics'){const q=new URLSearchParams(location.hash.split('?')[1]);q.set('account_id',account);q.set('status',status);q.set('media_type',media);history.replaceState(history.state,'','#topics?'+q);}
 },[accountsReady,account,status,media,me.workspace.id]);
 useEffect(()=>{if(!request||!['queued','running'].includes(request.state))return;let active=true;const timer=setInterval(()=>{void api('/ai-requests/'+request.request_id).then(r=>{if(!active)return;setRequest({...r,request_id:r.id});if(r.state==='succeeded'){setNotice('候选已生成，请核验理由与证据后采纳');void loadRef.current();}}).catch(e=>{if(active)setError(e as Error);});},2000);return ()=>{active=false;clearInterval(timer);};},[request?.request_id,request?.state]);
 async function detail(id:string){setError(null);try{const topic=await api('/topics/'+id);if(!mounted.current)return;setSelected(topic);setAction(null);setNotice('');}catch(e){if(mounted.current)setError(e as Error);}}
 const closeDetail=()=>{setSelected(null);setAction(null);setError(null);requestAnimationFrame(()=>{if(!detailTrigger.current?.isConnected)headingRef.current?.focus();});};
 async function act(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError(null);try{await fn();await loadRef.current();}catch(e){setError(e as Error);}finally{setBusy(false);}}
 return <section className="panel topics-panel"><div className="panel-heading"><div><h2 ref={headingRef} tabIndex={-1}>候选选题</h2><p className="muted">先看写作角度，再核对依据；采纳仅保存决策。</p></div><div className="button-row"><button disabled={busy||!accountsReady||loading} onClick={()=>void load()}>刷新候选</button>{canEdit&&<button className="primary" disabled={busy||!accountsReady||!account} onClick={()=>setGenerating(true)}>生成候选</button>}</div></div>
  <ErrorState error={accountError} retry={()=>setAccountReload(n=>n+1)}/><ErrorState error={listError} retry={()=>void load(failedMore.current)}/>{!selected&&<ErrorState error={error}/>} {notice&&!selected&&<p role="status">{notice}</p>}
  <div className="source-filters"><label>候选账号<select value={account} onChange={e=>setAccount(e.target.value)}><option value="">全部授权账号</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>选题状态<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部状态</option>{Object.entries(statuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>选题形式<select value={media} onChange={e=>setMedia(e.target.value)}><option value="">全部形式</option><option value="graphic">图文</option><option value="video">视频</option></select></label></div>
  {request&&<p><JobStatus state={request.state}/> {request.error_code??'生成建议，不自动采纳'}</p>}
  {!accountsReady?accountError?null:<Loading/>:!accounts.length?<Empty title="还没有运营账号"><a href="#settings?tab=accounts">前往添加账号</a></Empty>:<>
   {items.length>0&&<GenerationNotes generations={visibleGenerations.filter(g=>g.limitations.length||!g.complete)} accounts={items.map(t=>({generationId:t.generation_request_id,name:accounts.find(a=>a.id===t.account_id)?.name??''}))}/>}
   {loading&&!items.length?<Loading/>:items.length?<div className="topic-grid topic-list">{items.map(t=>{const p=displayOf(t),label=reviewLabel(p.source_review),riskCount=p.checks.length+p.assumptions.length;return <article className="topic-card topic-list-item" key={t.id}>
    <div className="topic-list-main"><div className="topic-list-meta"><span className={'badge '+t.effective_status}>{statuses[t.effective_status]}</span><span>{t.candidate.media_type==='graphic'?'图文':'视频'}</span>{t.parent_topic_id&&<span>变体</span>}</div><h3>{t.candidate.title}</h3><p className="topic-angle-preview">{t.candidate.original_angle}</p><div className="topic-list-notes"><span>{p.reference_source_count?`参考来源 ${p.reference_source_count} 个`:'原创提案'}</span>{label&&<span className="topic-check-label">{label}</span>}{riskCount>0&&<span className="topic-check-label">{label?'另有':''}{riskCount}项核验说明</span>}</div>{t.expired&&t.status==='accepted'&&<p className="topic-expired-note">来源时效需重新核验，已采纳决策保留。</p>}</div>
    <button className="topic-open" onClick={e=>{detailTrigger.current=e.currentTarget;void detail(t.id);}}>查看选题</button>
   </article>;})}</div>:loaded&&!listError?<Empty title={status==='proposed'?'暂无待采纳选题':'暂无匹配选题'}>{status==='proposed'?<><p>可以生成新建议，或查看历史选题。</p><div className="actions"><button className="primary" disabled={busy||!accountsReady||!account} onClick={()=>setGenerating(true)}>开始生成选题</button><button onClick={()=>setStatus('')}>查看历史选题</button></div></>:<p>调整账号、状态或形式筛选查看其他选题。</p>}</Empty>:null}
   {cursor&&<button disabled={loading||busy} onClick={()=>void load(true)}>{loading?'正在加载…':'更多候选'}</button>}
  </>}
{generating&&<Drawer title="生成候选选题" closeDisabled={busy} onClose={()=>setGenerating(false)}><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void act(async()=>{const end=new Date(),start=new Date(end.getTime()-Number(f.get('days'))*86400000);const r=await api('/topic-generations',{method:'POST',body:{account_id:account,window:{start:start.toISOString(),end:end.toISOString()},columns:String(f.get('columns')).split(/[，,]/).map(s=>s.trim()).filter(Boolean)}});setRequest(r);setGenerating(false);setNotice('生成任务已排队，可离开页面；结果不会自动采纳');});}}><fieldset disabled={busy}><label className="field">栏目（逗号分隔）<input name="columns" defaultValue="日常观察" required maxLength={1000}/></label><label className="field">来源窗口<select name="days"><option value="1">过去24小时</option><option value="7">过去7天</option><option value="30">过去30天</option></select></label><p className="muted">没有来源时仅提出原创建议；生成结果需要人工核验与采纳。</p><button className="primary">提交生成</button></fieldset></form></Drawer>}{selected&&<Drawer title="选题理由与证据" className="topic-detail-drawer" closeDisabled={busy} onClose={closeDetail}>
   <div className="topic-detail-feedback">
    <ErrorState error={error}/>
    {conflict&&<div className="topic-conflict"><p>请读取最新选题，核对状态和版本后再确认；已填写内容会保留。</p><button disabled={busy} onClick={()=>void act(async()=>{setSelected(await api('/topics/'+selected.id));setNotice('已读取最新选题，请重新核对后确认');})}>读取最新选题</button></div>}
    {notice&&<p role="status">{notice}</p>}
   </div>
   <div className="topic-detail-scroll" key={selected.id}>
    <section className="topic-detail-summary" aria-label="选题摘要">
     <div className="topic-detail-meta"><span className={'badge '+(selected.effective_status==='accepted'?'succeeded':'')}>{statuses[selected.effective_status]}</span><span className="badge">{selected.candidate.media_type==='graphic'?'图文':'视频'}</span>{selected.parent_topic_id&&<button className="topic-parent" disabled={busy} onClick={()=>void detail(selected.parent_topic_id)}>查看父题</button>}</div>
     <h3>{selected.candidate.title}</h3>
     <p className="topic-detail-meta muted"><span>{sourceCount?`参考来源 ${sourceCount} 个`:'原创提案'}</span></p>
     <p className="topic-detail-version muted">版本 {selected.version} · 更新于 {new Date(selected.updated_at).toLocaleString('zh-CN')}</p>
     {selected.expired&&<p className="topic-expiry" role="status">{selected.status==='accepted'?'来源时效需重新核验，已采纳决策保留。':'选题已过期，请重新生成或明确创建变体后核验。'}</p>}
    </section>
    <section className="topic-reading-section" aria-labelledby="topic-value-heading">
     <h3 id="topic-value-heading">这个选题，值得做在哪里</h3>
     <div className="topic-angle"><h4>原创角度</h4><p>{selected.candidate.original_angle}</p></div>
     <div className="topic-audience-grid"><div><h4>写给谁 · 解决什么需求</h4><p>{selected.candidate.audience}</p><p className="muted">需求：{selected.candidate.need}</p></div><div><h4>在什么场景下读</h4><p>{selected.candidate.scene}</p></div></div>
     <div className="topic-follow"><h4>读者为什么愿意继续关注</h4><p>{selected.candidate.follow_reason}</p></div>
    </section>
    <section className="topic-reading-section" aria-labelledby="topic-evidence-heading">
     <h3 id="topic-evidence-heading">选题依据</h3><p className="muted">来源原文与 AI 判断分开阅读；原文存在不代表内容已核实。</p>
     {!sourceCount&&<p className="topic-no-source">未引用外部来源，按原创提案核验。</p>}
     {[
      ['fact','来源原文（真实性待核验）'],
      ['inference','AI 推测（不是已验证事实）'],
      ['original_hypothesis','原创假设（待验证）']
     ].map(([kind,label])=>{const evidence=selected.evidence.filter((e:any)=>e.evidence_kind===kind);return evidence.length>0&&<div className="topic-evidence-group" key={kind}><h4>{label}</h4>{evidence.map((e:any)=><article className={'topic-evidence topic-evidence-'+kind} key={e.id}>
      {kind==='fact'?<blockquote>{e.claim}</blockquote>:<p>{e.claim}</p>}
      {(e.source_item_id||e.canonical_url)&&<div className="topic-evidence-source">{e.canonical_url?<a href={e.canonical_url} target="_blank" rel="noopener noreferrer">{e.title??'原始来源'} · 打开原始来源 ↗</a>:<p className="muted">{e.title??'来源链接未提供'}</p>}<p className="muted">观察时间：{e.captured_at?new Date(e.captured_at).toLocaleString('zh-CN'):'未提供'}</p></div>}
     </article>)}</div>;})}
    </section>
    <section className={riskGroups.length||selectedDisplay?.source_review?'topic-risks':'topic-reading-section'} aria-labelledby="topic-risks-heading">
     <h3 id="topic-risks-heading">使用前核对</h3>
     {selectedDisplay?.source_review&&<div><h4>来源核对</h4><p>{selectedDisplay.source_review==='title_only'?'本题存在仅有标题的事实来源，请打开原文核对具体事实。':'本题部分来源的生成时资料无法完整读取，请核对已有引用与原文。'}</p></div>}
     {riskGroups.length?riskGroups.map(g=><div key={g.label}><h4>{g.label}</h4><ul>{g.items.map((s:string,i:number)=><li key={i}>{s}</li>)}</ul></div>):<p className="muted">当前未列出额外核验事项，仍需人工核验选题依据。</p>}
    </section>
    <GenerationNotes generations={[selected.generation??legacyGeneration(selected)]} label="本次生成参考了什么"/>
    {selected.parent_topic_id&&<p className="topic-generation-inheritance muted">此变体沿用原题的生成说明，以上时间不代表变体重新生成。</p>}
    <details className="topic-score-details"><summary>AI评分依据 <span className="muted">· {scoreText(selected.score)}/100</span></summary><p className="muted">评分仅用于比较建议，不代表爆款概率。</p>{selected.candidate.score_breakdown.map((s:any)=><div className="topic-score-item" key={s.criterion}><div className="topic-score-line"><span>{criteria[s.criterion]} <small className="muted">权重 {weights[s.criterion]}%</small></span><meter min="0" max="5" value={s.score} aria-label={criteria[s.criterion]}/><span>{s.score}/5</span></div><p className="muted">{s.reason}</p></div>)}</details>
    {selected.candidate.estimated_hours!==null&&<section className="topic-reading-section"><h3>制作时间</h3><p>AI估计 {selected.candidate.estimated_hours} 小时，实际耗时需自行判断。</p></section>}
    <details className="topic-decision-history"><summary>决策记录 <span className="muted">· {selected.decisions.length}条</span></summary>{selected.decisions.length?<ol>{selected.decisions.map((d:any)=><li key={d.id}><div className="topic-detail-meta"><strong>{decisions[d.decision]??d.decision}</strong><time className="muted" dateTime={d.decided_at}>{new Date(d.decided_at).toLocaleString('zh-CN')}</time></div><p>{d.reason}</p></li>)}</ol>:<p className="muted">暂无决策记录。</p>}</details>
    {action&&<section className="topic-decision-form" ref={actionRef} aria-labelledby="topic-action-heading"><h3 id="topic-action-heading">{action==='accept'?'确认采纳选题':action==='reject'?'拒绝并说明原因':'明确创建变体'}</h3><p className="muted">{action==='accept'?'采纳仅保存本选题的决策，来源与假设仍需核验。':'原选题和历史决策会保留。'}</p>{actionUnavailable&&<p role="status">当前选题已不处于待采纳状态，请取消本次操作并核对最新状态。</p>}
     <form id="topic-decision-form" key={selected.id+':'+action} onSubmit={e=>{e.preventDefault();if(conflict||actionUnavailable)return;const f=new FormData(e.currentTarget),current=selected;void act(async()=>{const path=action==='variant'?'variants':action;const b=action==='reject'?{expected_version:current.version,reason:f.get('reason')}:action==='variant'?{goal:f.get('reason'),media_type:f.get('media_type')}:{expected_version:current.version};const r=await api('/topics/'+current.id+'/'+path,{method:'POST',body:b});const fresh=await api('/topics/'+(action==='variant'?r.id:current.id));setSelected(fresh);setAction(null);setNotice(action==='accept'?'已保存采纳决策':action==='reject'?'拒绝原因已保存':'变体已创建，父题保留');});}}><fieldset disabled={busy}>
      {action==='variant'&&<label className="field">建议形式<select name="media_type" defaultValue={selected.candidate.media_type}><option value="graphic">图文</option><option value="video">视频</option></select></label>}
      {action!=='accept'&&<label className="field">{action==='reject'?'拒绝原因':'变体目标'}<textarea name="reason" autoFocus required maxLength={action==='reject'?1000:10000}/></label>}
     </fieldset></form>
    </section>}
   </div>
   <div className="topic-detail-footer"><p className="muted">采纳后保存决策<br/>内容制作与发布在系统外完成</p><div className="button-row">{action?<><button disabled={busy} onClick={()=>{setAction(null);setError(null);}}>取消</button><button ref={confirmRef} className="primary" form="topic-decision-form" disabled={busy||conflict||actionUnavailable} aria-busy={busy}>{busy?'正在保存…':action==='accept'?'确认采纳':action==='reject'?'保存拒绝原因':'创建变体'}</button></>:<>{canEdit&&<><button aria-label="明确创建变体" disabled={busy} onClick={()=>setAction('variant')}>创建变体</button>{selected.effective_status==='proposed'&&<><button disabled={busy} onClick={()=>setAction('reject')}>拒绝并留因</button><button className="primary" disabled={busy} onClick={()=>setAction('accept')}>采纳选题</button></>}</>}</>}</div></div>
  </Drawer>}</section>;
}
