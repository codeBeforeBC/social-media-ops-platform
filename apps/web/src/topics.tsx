import React,{useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
import {Drawer,Empty,ErrorState,JobStatus} from './components';
import type {InstanceData} from '../../../packages/contracts/src/types';
const statuses:Record<string,string>={proposed:'待采纳',accepted:'已采纳',rejected:'已拒绝',expired:'已过期'};
const criteria:Record<string,string>={audience_need:'受众需求',yoyo_expression:'YOYO表达',follow_reason:'连续关注理由',clarity:'内容清楚',feasibility:'制作可行',timing:'时机'};
const decisions:Record<string,string>={accepted:'已采纳',rejected:'已拒绝',variant:'创建变体'};
export function TopicsPanel({me}:{me:InstanceData}){
 const [accounts,setAccounts]=useState<any[]>([]),[account,setAccount]=useState(''),[status,setStatus]=useState(''),[media,setMedia]=useState(''),[items,setItems]=useState<any[]>([]),[cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState<any>(null),[error,setError]=useState<Error|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[request,setRequest]=useState<any>(null),[generating,setGenerating]=useState(false),[action,setAction]=useState<'accept'|'reject'|'variant'|null>(null);
 const canEdit=true;
 const actionRef=useRef<HTMLElement>(null);
 const confirmRef=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(action)actionRef.current?.scrollIntoView({block:'nearest'});if(action==='accept')confirmRef.current?.focus();},[action]);
 const seenRisks=new Set<string>();
 const riskGroups=selected?[
  {label:'待补信息',items:selected.missing_inputs},
  {label:'选题假设',items:selected.candidate.assumptions},
  {label:'注意事项',items:selected.warnings}
 ].map(g=>({...g,items:g.items.filter((s:string)=>{if(seenRisks.has(s))return false;seenRisks.add(s);return true;})})).filter(g=>g.items.length):[];
 const sourceCount=selected?.evidence.filter((e:any)=>e.source_item_id).length??0;
 const conflict=error instanceof ApiError&&error.status===409;
 const actionUnavailable=action!=='variant'&&selected?.effective_status!=='proposed';
 async function load(more=false){try{const q=new URLSearchParams();if(account)q.set('account_id',account);if(status)q.set('status',status);if(media)q.set('media_type',media);if(more&&cursor)q.set('cursor',cursor);const r=await api('/topics?'+q);setItems(old=>more?[...old,...r.items]:r.items);setCursor(r.next_cursor);}catch(e){setError(e as Error);}}
 useEffect(()=>{void api('/accounts').then(r=>{setAccounts(r.items);setAccount(r.items[0]?.id??'');}).catch(e=>setError(e));},[]);
 useEffect(()=>{void load();},[account,status,media]);
 useEffect(()=>{if(!request||!['queued','running'].includes(request.state))return;const timer=setInterval(()=>{void api('/ai-requests/'+request.request_id).then(r=>{setRequest({...r,request_id:r.id});if(r.state==='succeeded'){setNotice('候选已生成，请核验理由与证据后采纳');void load();}}).catch(e=>setError(e));},2000);return ()=>clearInterval(timer);},[request?.request_id,request?.state]);
 async function detail(id:string){setError(null);try{const topic=await api('/topics/'+id);setSelected(topic);setAction(null);setNotice('');}catch(e){setError(e as Error);}}
 async function act(fn:()=>Promise<void>){setBusy(true);setError(null);try{await fn();await load();}catch(e){setError(e as Error);}finally{setBusy(false);}}
 return <section className="panel"><div className="panel-heading"><div><h2>候选选题</h2><p className="muted">评分用于比较建议；缺项和假设需核验。采纳后保存决策。</p></div><div className="button-row"><button disabled={busy} onClick={()=>void load()}>刷新候选</button>{canEdit&&<button className="primary" disabled={busy||!account} onClick={()=>setGenerating(true)}>生成候选</button>}</div></div><ErrorState error={error}/>{notice&&<p role="status">{notice}</p>}<div className="source-filters"><label>候选账号<select value={account} onChange={e=>setAccount(e.target.value)}><option value="">全部授权账号</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>选题状态<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部状态</option>{Object.entries(statuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>选题形式<select value={media} onChange={e=>setMedia(e.target.value)}><option value="">全部形式</option><option value="graphic">图文</option><option value="video">视频</option></select></label></div>{request&&<p><JobStatus state={request.state}/> {request.error_code??'生成建议，不自动采纳'}</p>}{!accounts.length&&<p className="muted">先在工作区设置中建立账号，再生成候选。</p>}{items.length?<div className="topic-grid">{items.map(t=><article className="topic-card" key={t.id}><span className="badge">{statuses[t.effective_status]} · {t.candidate.media_type==='graphic'?'图文':'视频'}</span>{t.parent_topic_id&&<p className="muted">明确创建的变体</p>}<h3>{t.candidate.title}</h3><p>{t.candidate.original_angle}</p><p><strong>关注理由：</strong>{t.candidate.follow_reason}</p><p className="muted">建议评分 {t.score}/100 · {t.candidate.evidence_refs.length}条引用 · {t.candidate.estimated_hours===null?'工时待估':`${t.candidate.estimated_hours}小时`}</p>{t.expired&&t.status==='accepted'&&<p>来源时效需重新核验，已采纳决策保留。</p>}{t.missing_inputs.length>0&&<p>待补：{t.missing_inputs.join('；')}</p>}<button onClick={()=>void detail(t.id)}>查看理由与采纳</button></article>)}</div>:<Empty title="暂无候选选题">选择账号生成建议，或调整状态筛选查看历史。</Empty>}{cursor&&<button onClick={()=>void load(true)}>更多候选</button>}{generating&&<Drawer title="生成候选选题" onClose={()=>setGenerating(false)}><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void act(async()=>{const end=new Date(),start=new Date(end.getTime()-Number(f.get('days'))*86400000);const r=await api('/topic-generations',{method:'POST',body:{account_id:account,window:{start:start.toISOString(),end:end.toISOString()},columns:String(f.get('columns')).split(/[，,]/).map(s=>s.trim()).filter(Boolean),capacity_hours:f.get('capacity')?Number(f.get('capacity')):null}});setRequest(r);setGenerating(false);setNotice('生成任务已排队，可离开页面；结果不会自动采纳');});}}><fieldset disabled={busy}><label className="field">栏目（逗号分隔）<input name="columns" defaultValue="日常观察" required maxLength={1000}/></label><label className="field">来源窗口<select name="days"><option value="1">过去24小时</option><option value="7">过去7天</option><option value="30">过去30天</option></select></label><label className="field">本次可用工时<input name="capacity" type="number" min="0" max="168" step="0.5"/></label><p className="muted">没有来源时仅生成明确原创假设，工时未知会列为待补项。</p><button className="primary">提交生成</button></fieldset></form></Drawer>}{selected&&<Drawer title="选题理由与证据" className="topic-detail-drawer" closeDisabled={busy} onClose={()=>{setSelected(null);setAction(null);}}>
   <div className="topic-detail-feedback">
    <ErrorState error={error}/>
    {conflict&&<div className="topic-conflict"><p>请读取最新选题，核对状态和版本后再确认；已填写内容会保留。</p><button disabled={busy} onClick={()=>void act(async()=>{setSelected(await api('/topics/'+selected.id));setNotice('已读取最新选题，请重新核对后确认');})}>读取最新选题</button></div>}
    {notice&&<p role="status">{notice}</p>}
   </div>
   <div className="topic-detail-scroll" key={selected.id}>
    <section className="topic-detail-summary" aria-label="选题摘要">
     <div className="topic-detail-meta"><span className={'badge '+(selected.effective_status==='accepted'?'succeeded':'')}>{statuses[selected.effective_status]}</span><span className="badge">{selected.candidate.media_type==='graphic'?'图文':'视频'}</span>{selected.parent_topic_id&&<button className="topic-parent" disabled={busy} onClick={()=>void detail(selected.parent_topic_id)}>查看父题</button>}</div>
     <h3>{selected.candidate.title}</h3>
     <p className="topic-detail-meta muted"><span>建议评分 {selected.score}/100</span><span>来源引用 {sourceCount}条</span><span>{selected.candidate.estimated_hours===null?'制作工时待估':`预计制作 ${selected.candidate.estimated_hours}小时`}</span></p>
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
     {!sourceCount&&<p className="topic-no-source">无来源引用，按原创提案核验。</p>}
     {[
      ['fact','来源原文（真实性待核验）'],
      ['inference','AI 推测（不是已验证事实）'],
      ['original_hypothesis','原创假设（待验证）']
     ].map(([kind,label])=>{const evidence=selected.evidence.filter((e:any)=>e.evidence_kind===kind);return evidence.length>0&&<div className="topic-evidence-group" key={kind}><h4>{label}</h4>{evidence.map((e:any)=><article className={'topic-evidence topic-evidence-'+kind} key={e.id}>
      {kind==='fact'?<blockquote>{e.claim}</blockquote>:<p>{e.claim}</p>}
      {(e.source_item_id||e.canonical_url)&&<div className="topic-evidence-source">{e.canonical_url?<a href={e.canonical_url} target="_blank" rel="noopener noreferrer">{e.title??'原始来源'} · 打开原始来源 ↗</a>:<p className="muted">{e.title??'来源链接未提供'}</p>}<p className="muted">观察时间：{e.captured_at?new Date(e.captured_at).toLocaleString('zh-CN'):'未提供'}</p></div>}
     </article>)}</div>;})}
    </section>
    <section className={riskGroups.length?'topic-risks':'topic-reading-section'} aria-labelledby="topic-risks-heading">
     <h3 id="topic-risks-heading">假设与待核验事项</h3>
     {riskGroups.length?riskGroups.map(g=><div key={g.label}><h4>{g.label}</h4><ul>{g.items.map((s:string,i:number)=><li key={i}>{s}</li>)}</ul></div>):<p className="muted">当前未列出待补项，仍需人工核验选题依据。</p>}
    </section>
    <details className="topic-score-details"><summary>评分解释 <span className="muted">· {selected.score}/100</span></summary><p className="muted">评分仅用于比较建议，不代表爆款概率。</p>{selected.candidate.score_breakdown.map((s:any)=><div className="topic-score-item" key={s.criterion}><div className="topic-score-line"><span>{criteria[s.criterion]}</span><meter min="0" max="5" value={s.score} aria-label={criteria[s.criterion]}/><span>{s.score}/5</span></div><p className="muted">{s.reason}</p></div>)}</details>
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
