import React,{useEffect,useState,useRef} from 'react';
import {api,ApiError} from './api';
import {ErrorState,JobStatus} from './components';
const publicLabels:Record<string,string>={matched:'公开身份已匹配',inconclusive:'本次无法确认',not_found:'平台返回账号不可用'};
const sessionLabels:Record<string,string>={unknown:'登录身份未确认',matched:'当前登录身份一致',mismatched:'当前登录账号不一致',auth_required:'需要在指定档案登录',unsupported:'登录身份读取未支持'};
const capabilityLabels:Record<string,string>={unknown:'未验证',supported:'可读取',unsupported:'不支持'};
const reasons:Record<string,string>={AUTH_REQUIRED:'在指定浏览器档案登录小红书后重新验证。',ACCOUNT_MISMATCH:'请核对目标账号或在指定档案切换登录，系统不会替换登记身份。',BROWSER_BUSY:'该档案正在采集或验证，请稍后重试。',BROWSER_UNAVAILABLE:'请启动本机浏览器和桥接服务后重试。',PROFILE_UNAVAILABLE:'档案未连接，请在浏览器连接对应档案后刷新。',SOURCE_CHANGED:'页面身份字段未能可靠识别，请稍后重试或检查读取方式。',ACCESS_DENIED:'平台要求人工处理安全验证，请在浏览器完成后重试。',RATE_LIMITED:'平台或本地限流，请稍后重试。',TIMEOUT:'本次验证超时，账号与历史结果仍保留。',BRIDGE_UNSUPPORTED:'当前桥接版本尚不支持账号验证，请更新桥接。',STALE_INPUT:'绑定已改变，这次结果没有应用，请使用当前档案重新验证。',CANCELLED:'验证已取消，历史结果保留。'};
export function BrowserProfileInput({value,onChange,name='browser_profile_ref'}:{value?:string;onChange?:(value:string)=>void;name?:string}){
 const [items,setItems]=useState<any[]>([]),[error,setError]=useState<Error|null>(null),[busy,setBusy]=useState(false);
 const load=async()=>{setBusy(true);setError(null);try{setItems((await api('/account-browser-profiles')).items);}catch(e){setError(e as Error);}finally{setBusy(false);}};
 useEffect(()=>{void load();},[]);
 return <div className="account-profile-field"><label className="field">浏览器档案（仅配置引用）<select name={name} {...(value!==undefined?{value,onChange:e=>onChange?.(e.target.value)}:{defaultValue:''})}><option value="">未选择档案</option>{value&&!items.some(p=>p.id===value)&&<option value={value}>{value}（当前未连接）</option>}{items.map(p=><option key={p.id} value={p.id}>{p.id}</option>)}</select></label><button type="button" disabled={busy} onClick={()=>void load()}>{busy?'读取档案中…':'刷新档案'}</button>{error&&<p className="muted">浏览器档案暂不可读取：{error.message}；不影响仅保存账号。</p>}<p className="muted">选择你已登录小红书的浏览器档案，不在工作台输入密码或Cookie。浏览器关闭或登录切换后需重新验证。</p></div>;
}
export function VerificationPanel({account,onRefresh}:{account:any;onRefresh:()=>Promise<void>}){
 const [profile,setProfile]=useState<string>(account.browser_profile_ref??''),[failure,setFailure]=useState<Error|null>(null),[pollError,setPollError]=useState<Error|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[history,setHistory]=useState<any[]>([]),[historyOpen,setHistoryOpen]=useState(false),[cursor,setCursor]=useState<string|null>(null),[historyError,setHistoryError]=useState<Error|null>(null),[historyBusy,setHistoryBusy]=useState(false),[ack,setAck]=useState(false),[now,setNow]=useState(Date.now()),[pending,setPending]=useState<any>(null);
 const previousBinding=useRef<string>(account.browser_profile_ref??'');
 const summary=account.verification,latest=pending&&pending.id!==summary?.latest?.id?pending:summary?.latest,result=latest?.result,current=pending?.id===latest?.id?true:!!summary?.current;
 const active=latest&&['queued','running'].includes(latest.state),activeId=active?latest.job_id:null;
 const retryAt=new Date(account.verification_next_at??0).getTime(),cooling=retryAt>now;
 useEffect(()=>{const next=account.browser_profile_ref??'',previous=previousBinding.current;setProfile(draft=>draft===previous?next:draft);previousBinding.current=next;},[account.id,account.identity_binding_version]);
 useEffect(()=>{setAck(false);},[account.id,account.identity_binding_version,latest?.id]);
 useEffect(()=>{if(pending?.id===summary?.latest?.id)setPending(null);},[pending?.id,summary?.latest?.id]);
 useEffect(()=>{if(!cooling)return;const timer=setTimeout(()=>setNow(Date.now()),Math.min(1000,retryAt-Date.now()+20));return()=>clearTimeout(timer);},[cooling,now,retryAt]);
 useEffect(()=>{
  if(!activeId)return;let stopped=false,timer:ReturnType<typeof setTimeout>,delay=2000;
  const poll=async()=>{try{await onRefresh();if(!stopped){setPollError(null);delay=2000;}}catch(e){if(!stopped){setPollError(e as Error);delay=Math.min(delay*2,15000);}}if(!stopped)timer=setTimeout(()=>void poll(),delay);};
  timer=setTimeout(()=>void poll(),delay);return()=>{stopped=true;clearTimeout(timer);};
 },[account.id,activeId]);
 const act=async(fn:()=>Promise<unknown>,message:string)=>{if(busy)return;setBusy(true);setFailure(null);setNotice('');try{await fn();setNotice(message);await onRefresh();setNow(Date.now());}catch(e){setFailure(e as Error);}finally{setBusy(false);}};
 async function loadHistory(more=false){setHistoryBusy(true);setHistoryError(null);try{const r=await api(`/accounts/${account.id}/verifications?limit=10${more&&cursor?'&cursor='+encodeURIComponent(cursor):''}`);setHistory(old=>more?[...old,...r.items]:r.items);setCursor(r.next_cursor);}catch(e){setHistoryError(e as Error);}finally{setHistoryBusy(false);}}
 const errorCode=result?.error_code??latest?.error_code;
 const verify=()=>act(async()=>{const r=await api(`/accounts/${account.id}/verifications`,{method:'POST',body:{expected_version:account.version,binding_version:account.identity_binding_version}});setPending(r.verification);},'验证请求已提交，执行结果会自动更新');
 return <section className="account-verification" aria-label="账号身份核验"><h3>身份核验与可用范围</h3><button type="button" disabled={busy} onClick={()=>void act(async()=>{},'已刷新核验状态')}>刷新核验状态</button>
  <ErrorState error={failure} retry={()=>void act(async()=>{},'已刷新核验状态')}/>{failure instanceof ApiError&&failure.fields.retry_at&&<p>可重试时间：{String(failure.fields.retry_at)}</p>}{notice&&<p role="status">{notice}</p>}
  <BrowserProfileInput value={profile} onChange={setProfile}/><button type="button" disabled={busy||profile===(account.browser_profile_ref??'')} onClick={()=>void act(()=>api('/accounts/'+account.id,{method:'PATCH',body:{browser_profile_ref:profile||null,expected_version:account.version}}),'浏览器档案已保存，旧绑定结果不代表当前状态')}>保存浏览器档案</button>
  <div className="actions"><button type="button" className="primary" disabled={busy||(!active&&(cooling||!account.browser_profile_ref))||profile!==(account.browser_profile_ref??'')} onClick={()=>void verify()}>{active?'查看 / 复用当前验证':'验证账号'}</button>{active&&<button type="button" disabled={busy} onClick={()=>void act(()=>api(`/jobs/${latest.job_id}/cancel`,{method:'POST',body:{reason:'用户取消账号验证'}}),'验证已取消，历史记录仍保留')}>取消验证</button>}</div>
  {profile!==(account.browser_profile_ref??'')&&<p className="muted">档案选择尚未保存，请先保存后验证。</p>}{cooling&&!active&&<p className="muted">本地验证冷却中，可在{new Date(retryAt).toLocaleTimeString('zh-CN')}后重新验证。</p>}
  <ErrorState error={pollError} retry={()=>void onRefresh().then(()=>setPollError(null)).catch(e=>setPollError(e as Error))}/>
  {latest?<><p><JobStatus state={latest.state}/> {active?'正在等待或执行只读验证，关闭页面不会丢失记录。':current&&!summary.stale?'本次观察':'历史观察，需要重新验证'}</p>
    <dl><dt>公开身份</dt><dd>{current&&result?publicLabels[result.public_status]:'尚未验证当前绑定身份'}</dd><dt>登录身份</dt><dd>{current&&result?sessionLabels[result.session_status]:'登录身份未确认'}</dd><dt>平台返回昵称 / 展示号</dt><dd>{result?.public_profile?`${result.public_profile.nickname} / ${result.public_profile.display_handle??'未提供'}`:'未取得可靠资料'}</dd>
    {result?.session_id&&<><dt>本次观察到的登录内部ID</dt><dd className="account-id">{result.session_id}</dd></>}
    <dt>最近请求 / 开始 / 完成</dt><dd>{new Date(latest.requested_at).toLocaleString('zh-CN')} / {latest.started_at?new Date(latest.started_at).toLocaleString('zh-CN'):'未开始'} / {latest.finished_at?new Date(latest.finished_at).toLocaleString('zh-CN'):'未完成'}</dd>
    <dt>实际观察时间</dt><dd>{result?.observed_at?new Date(result.observed_at).toLocaleString('zh-CN'):'尚无观察结果'}</dd></dl>
    {errorCode&&<p role="status" className="account-warning">{reasons[errorCode]??'本次未完成可靠核验，请检查浏览器后重试。'} <small>{errorCode}</small></p>}
    {result&&<ul className="account-capabilities">{Object.entries(result.capabilities).map(([key,state])=><li key={key}>{({public_identity:'公开身份',current_session_identity:'当前登录身份',own_account_metrics:'后台指标'} as any)[key]}：{capabilityLabels[String(state)]}{(!current||summary.stale)&&'（历史观察）'}</li>)}</ul>}
  </>:<p>已登记，平台身份未验证、登录身份未验证，尚无身份核验记录。保存账号和档案都不代表登录或授权成功。</p>}
  {summary?.last_success&&summary.last_success.id!==latest?.id&&<p className="muted">最近公开身份匹配：{new Date(summary.last_success.result.observed_at).toLocaleString('zh-CN')}（历史记录，不覆盖本次失败或当前绑定）。</p>}
  <p>管理确认：{summary?.confirmed?'已人工确认管理此账号':'尚未确认当前核验结果'}</p>
  {current&&!summary?.stale&&result?.public_status==='matched'&&!summary?.confirmed&&<div className="account-confirmation"><label className="checkbox"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>我已核对以上目标账号，确认将它用于本工作区运营</label><p className="muted">这是人工管理声明，不证明账号所有权，也不代替小红书授权。登录身份不一致时仍不能读取目标私有后台。</p><button type="button" disabled={busy||!ack} onClick={()=>void act(()=>api(`/accounts/${account.id}/identity-confirmation`,{method:'POST',body:{verification_id:latest.id,expected_version:account.version,confirmed:true}}),'已保存人工管理确认')}>确认管理此账号</button></div>}
  <details open={historyOpen} onToggle={e=>{const opened=e.currentTarget.open;setHistoryOpen(opened);if(opened&&!historyOpen)void loadHistory();}}><summary>验证历史记录</summary><ErrorState error={historyError} retry={()=>void loadHistory()}/><button type="button" disabled={historyBusy} onClick={()=>void loadHistory()}>刷新验证记录</button>{history.length?<ol>{history.map(v=><li key={v.id}><JobStatus state={v.state}/> {new Date(v.requested_at).toLocaleString('zh-CN')} · 绑定版本{v.binding_version}<p>{v.result?`${publicLabels[v.result.public_status]}；${sessionLabels[v.result.session_status]}`:v.error_code??'尚无生效结果'}{v.result?.error_code&&` · ${v.result.error_code}`}</p></li>)}</ol>:<p>{historyBusy?'读取中…':'尚无验证记录'}</p>}{cursor&&<button type="button" disabled={historyBusy} onClick={()=>void loadHistory(true)}>更多验证记录</button>}</details>
 </section>;
}
