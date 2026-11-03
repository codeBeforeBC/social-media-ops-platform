import React,{useEffect,useState,useRef} from 'react';
import {api,ApiError} from './api';
import {ErrorState,JobStatus} from './components';
const publicLabels:Record<string,string>={matched:'公开身份已匹配',inconclusive:'本次无法确认',not_found:'平台返回账号不可用'};
const sessionLabels:Record<string,string>={unknown:'未能识别当前登录账号',matched:'当前登录身份一致',mismatched:'当前登录账号不一致',auth_required:'需要登录小红书',unsupported:'暂不支持识别登录账号'};
const reasons:Record<string,string>={AUTH_REQUIRED:'请在所选浏览器登录小红书后重新验证。',ACCOUNT_MISMATCH:'请在所选浏览器切换到目标小红书账号后重试，系统不会替换登记身份。',BROWSER_BUSY:'所选浏览器正在执行其他操作，请稍后重试。',BROWSER_UNAVAILABLE:'请打开用于验证的浏览器后重试。',PROFILE_UNAVAILABLE:'所选浏览器未连接，请连接后刷新列表。',SOURCE_CHANGED:'暂时无法可靠识别账号信息，请稍后再试。',ACCESS_DENIED:'平台要求人工处理安全验证，请在浏览器完成后重试。',RATE_LIMITED:'请求过于频繁，请稍后重试。',TIMEOUT:'本次验证超时，账号与历史结果仍保留。',BRIDGE_UNSUPPORTED:'当前验证服务尚不支持此操作，请更新应用后重试。',STALE_INPUT:'验证浏览器已更换，请使用当前浏览器重新验证。',CANCELLED:'验证已取消，历史结果保留。'};
export function BrowserProfileInput({value,onChange,name='browser_profile_ref',required=false,label='验证所用浏览器',description='选择已登录小红书的浏览器，用于核对账号身份。'}:{value?:string;onChange?:(value:string)=>void;name?:string;required?:boolean;label?:string;description?:string}){
 const [items,setItems]=useState<any[]>([]),[error,setError]=useState<Error|null>(null),[busy,setBusy]=useState(false);
 const load=async()=>{setBusy(true);setError(null);try{setItems((await api('/account-browser-profiles')).items);}catch(e){setError(e as Error);}finally{setBusy(false);}};
 useEffect(()=>{void load();},[]);
 return <div className="account-profile-field"><label className="field"><span>{label}{required&&<span aria-hidden="true"> *</span>}</span><select name={name} required={required} {...(value!==undefined?{value,onChange:e=>onChange?.(e.target.value)}:{defaultValue:''})}><option value="">请选择浏览器</option>{value&&!items.some(p=>p.id===value)&&<option value={value}>{value}（未连接）</option>}{items.map(p=><option key={p.id} value={p.id}>{p.id}</option>)}</select></label><button type="button" disabled={busy} onClick={()=>void load()}>{busy?'正在读取…':'刷新列表'}</button>{error&&<p className="muted">暂时无法读取浏览器列表：{error.message}；请连接浏览器后刷新。</p>}<p className="muted">{description}</p></div>;
}
export function VerificationPanel({account,onRefresh,onConfirmed,onBusyChange}:{account:any;onRefresh:()=>Promise<void>;onConfirmed:()=>Promise<void>;onBusyChange:(busy:boolean)=>void}){
 const [profile,setProfile]=useState<string>(account.browser_profile_ref??''),[failure,setFailure]=useState<Error|null>(null),[pollError,setPollError]=useState<Error|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[history,setHistory]=useState<any[]>([]),[historyOpen,setHistoryOpen]=useState(false),[cursor,setCursor]=useState<string|null>(null),[historyError,setHistoryError]=useState<Error|null>(null),[historyBusy,setHistoryBusy]=useState(false),[ack,setAck]=useState(false),[now,setNow]=useState(Date.now()),[pending,setPending]=useState<any>(null),[browserOpen,setBrowserOpen]=useState(!account.browser_profile_ref);
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
 const act=async(fn:()=>Promise<unknown>,message:string,confirmed=false)=>{if(busy)return;setBusy(true);onBusyChange(true);setFailure(null);setNotice('');try{await fn();if(confirmed){await onConfirmed();return;}setNotice(message);await onRefresh();setNow(Date.now());}catch(e){setFailure(e as Error);}finally{setBusy(false);onBusyChange(false);}};
 async function loadHistory(more=false){setHistoryBusy(true);setHistoryError(null);try{const r=await api(`/accounts/${account.id}/verifications?limit=10${more&&cursor?'&cursor='+encodeURIComponent(cursor):''}`);setHistory(old=>more?[...old,...r.items]:r.items);setCursor(r.next_cursor);}catch(e){setHistoryError(e as Error);}finally{setHistoryBusy(false);}}
 const errorCode=result?.error_code??latest?.error_code;
 const verify=()=>act(async()=>{const r=await api(`/accounts/${account.id}/verifications`,{method:'POST',body:{expected_version:account.version,binding_version:account.identity_binding_version}});setPending(r.verification);},'验证请求已提交，执行结果会自动更新');
 const profileChanged=profile!==(account.browser_profile_ref??''),activeCurrent=!!active&&current;
 const fresh=current&&!summary?.stale;
 const loginStatus=result?.session_status==='unknown'&&result?.capabilities.current_session_identity==='unsupported'?'unsupported':result?.session_status;
 const needsLoginHelp=fresh&&result&&!activeCurrent&&latest.state!=='cancelled'&&(['auth_required','mismatched','unsupported'].includes(loginStatus)||(loginStatus==='unknown'&&result.public_status==='matched'));
 let title='这个账号还未验证',description='选择已登录小红书的浏览器，开始验证。',tone='neutral';
 if(latest){
  if(!current){title='需要重新验证';description='验证浏览器已更换，历史观察，需要重新验证。';tone='warning';}
  else if(activeCurrent){title='正在验证账号';description='结果会自动更新，关闭窗口后也可继续查看。';}
  else if(latest.state==='cancelled'){title='本次验证已取消';description='账号记录保留，可以重新发起验证。';}
  else if(result?.session_status==='auth_required'){title='需要登录小红书';description=reasons.AUTH_REQUIRED!;tone='warning';}
  else if(result?.session_status==='mismatched'){title='浏览器登录账号不一致';description=reasons.ACCOUNT_MISMATCH!;tone='warning';}
  else if(latest.state==='failed'||result?.public_status!=='matched'){title='暂时无法确认账号';description=reasons[errorCode]??'请检查浏览器和目标账号后重新验证。';tone='warning';}
  else if(!fresh){title='需要重新验证';description='上次结果已过期，历史观察，需要重新验证。';tone='warning';}
  else{title=result.session_status==='matched'?'账号身份已匹配':'主页账号已匹配';description=result.session_status==='matched'?'公开主页与当前登录账号一致。':loginStatus==='unsupported'?'当前验证工具暂不支持识别浏览器登录账号；公开主页匹配不代表登录验证完成。':'已匹配公开主页，但未能识别所选浏览器当前登录的账号；这不代表未登录。';tone=result.session_status==='matched'?'success':'warning';}
 }
 const observedAt=result?.observed_at??latest?.finished_at??latest?.requested_at;
 const timeText=(value:string|null|undefined)=>value?new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'尚无记录';
 const historyRows=historyOpen&&latest&&!history.some(v=>v.id===latest.id)?[latest,...history]:history;
 const applyBrowser=()=>act(async()=>{await api('/accounts/'+account.id,{method:'PATCH',body:{browser_profile_ref:profile||null,expected_version:account.version}});setBrowserOpen(false);},'验证浏览器已更换，请重新验证');
 return <section className="account-verification" aria-label="账号身份核验">
  <div className="verification-heading"><h3>账号验证</h3><button type="button" className="verification-link" disabled={busy} onClick={()=>void act(async()=>{},'已刷新验证结果')}>刷新结果</button></div>
  <ErrorState error={failure} retry={()=>void act(async()=>{},'已读取最新账号，请重新确认操作')}/>{failure instanceof ApiError&&failure.fields.retry_at&&<p className="verification-note">可重试时间：{timeText(String(failure.fields.retry_at))}</p>}{notice&&<p role="status" className="verification-note">{notice}</p>}
  <div className={'verification-result '+tone}>
   <div className="verification-result-heading"><h4>{title}</h4>{latest&&current?<JobStatus state={latest.state}/>:<span className="badge">{latest?'需重验':'未验证'}</span>}</div>
   <p className="verification-description">{description}</p>
   {fresh&&result?.public_profile&&<p className="verification-person"><strong>{result.public_profile.nickname}</strong>{result.public_profile.display_handle&&<span>小红书号 {result.public_profile.display_handle}</span>}</p>}
   <dl className="verification-facts"><div><dt>主页账号</dt><dd>{fresh&&result?publicLabels[result.public_status]:activeCurrent?'验证中':'尚未确认'}</dd></div><div><dt>浏览器登录</dt><dd>{fresh&&result?sessionLabels[loginStatus]:activeCurrent?'验证中':'登录身份未确认'}</dd></div></dl>
   <div className="verification-result-footer"><span>{activeCurrent?'提交时间':'最近验证'} <time dateTime={observedAt}>{timeText(observedAt)}</time></span></div>
   {needsLoginHelp&&<div className="verification-login-help" role="note" aria-label="登录验证指引">
    <h5>{loginStatus==='unsupported'?'当前无法自动核对登录账号':loginStatus==='auth_required'?'先登录目标小红书账号':loginStatus==='mismatched'?'先切换到目标小红书账号':'完成登录账号核对'}</h5>
    {loginStatus==='unsupported'?<ol><li>请在用于验证的浏览器中打开小红书，进入自己的个人主页，人工核对目标账号。</li><li>当前工具暂不支持自动识别；反复重试不能保证解决，可在应用支持此能力后重新验证。</li></ol>:<ol>
     <li>在下方“验证浏览器”中检查当前选择；选错时点击“更换浏览器”。</li>
     <li>在该浏览器打开小红书，进入自己的个人主页，核对是否为上方目标账号；未登录或账号不对时，先登录或切换。{loginStatus==='mismatched'&&'系统不会替换登记的账号。'}</li>
     <li>保持该浏览器打开，回到这里点击“重新验证”。</li>
    </ol>}
    {loginStatus==='unknown'&&<p>已登录仍无法识别时，可能是网页信息尚未加载完整或页面发生变化，可稍后重试。</p>}
    <p>人工“确认用于运营”不会改变登录验证结果。</p>
   </div>}
  </div>
  <ErrorState error={pollError} retry={()=>void onRefresh().then(()=>setPollError(null)).catch(e=>setPollError(e as Error))}/>
  <div className="verification-primary-actions"><button type="button" className="primary" disabled={busy||activeCurrent||cooling||!account.browser_profile_ref||profileChanged} onClick={()=>void verify()}>{activeCurrent?'验证中…':latest?'重新验证':'验证账号'}</button>{activeCurrent&&<button type="button" disabled={busy} onClick={()=>void act(()=>api(`/jobs/${latest.job_id}/cancel`,{method:'POST',body:{reason:'用户取消账号验证'}}),'验证已取消，记录仍保留')}>取消验证</button>}</div>
  {cooling&&!activeCurrent&&<p className="verification-note">可在 {new Date(retryAt).toLocaleTimeString('zh-CN')} 后重新验证。</p>}
  <div className="verification-browser-heading"><div><span>验证浏览器</span><p>{account.browser_profile_ref?'使用已选择的浏览器核对账号':'请先选择已登录小红书的浏览器'}</p></div><button type="button" className="verification-link" disabled={busy} aria-expanded={browserOpen} onClick={()=>setBrowserOpen(open=>!open)}>{browserOpen?'收起设置':account.browser_profile_ref?'更换浏览器':'选择浏览器'}</button></div>
  {browserOpen&&<div className="verification-browser-editor" aria-label="更换验证浏览器"><fieldset disabled={busy}><BrowserProfileInput value={profile} onChange={setProfile}/><p className="verification-note">更换后需要重新验证账号。</p><div className="verification-browser-actions"><button type="button" disabled={busy||!profileChanged} onClick={()=>void applyBrowser()}>确认更换</button><button type="button" disabled={busy} onClick={()=>{setProfile(account.browser_profile_ref??'');setBrowserOpen(false);}}>取消更换</button></div></fieldset></div>}
  {profileChanged&&<p className="verification-note">请先确认更换浏览器，再重新验证。</p>}
  {summary?.last_success&&summary.last_success.id!==latest?.id&&<p className="verification-note">上次公开身份匹配：{timeText(summary.last_success.result.observed_at)}。历史记录不覆盖本次结果。</p>}
  {summary?.confirmed?<p className="verification-confirmed">已确认用于运营</p>:current&&!summary?.stale&&result?.public_status==='matched'&&<div className="account-confirmation"><h4>将此账号用于工作区运营</h4><label className="checkbox"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>这是我要运营的账号</label><p className="verification-note">仅记录你的确认，不代表平台授权。</p><button type="button" disabled={busy||!ack} onClick={()=>void act(()=>api(`/accounts/${account.id}/identity-confirmation`,{method:'POST',body:{verification_id:latest.id,expected_version:account.version,confirmed:true}}),'已保存运营账号确认',true)}>确认用于运营</button></div>}
  <details className="verification-history" open={historyOpen} onToggle={e=>{const opened=e.currentTarget.open;setHistoryOpen(opened);if(opened&&!historyOpen)void loadHistory();}}>
   <summary><span>验证历史</span><small>{history.length?`${history.length} 条已读取`:'按时间查看'}</small></summary>
   <div className="verification-history-tools"><span>{historyBusy?'正在读取历史…':'最近记录在前 · 历史结果仅供参考'}</span><button type="button" className="verification-link" disabled={historyBusy} onClick={()=>void loadHistory()}>刷新记录</button></div><ErrorState error={historyError} retry={()=>void loadHistory()}/>
   {historyRows.length?<ol className="verification-timeline">{historyRows.map(v=>{const item=v.id===latest?.id?latest:v;return <li key={item.id}><div className="verification-history-meta"><time dateTime={item.result?.observed_at??item.finished_at??item.requested_at}>{timeText(item.result?.observed_at??item.finished_at??item.requested_at)}</time><JobStatus state={item.state}/></div><p>{item.result?`${publicLabels[item.result.public_status]} · ${sessionLabels[item.result.session_status]}`:item.state==='queued'?'等待开始验证':item.state==='running'?'正在核对账号':item.state==='cancelled'?'本次验证已取消':'未取得有效结果'}</p>{item.result?.error_code&&<p className="verification-history-reason">{reasons[item.result.error_code]??'本次验证未完成，请检查浏览器后重试。'}</p>}<small>{item.binding_version===account.identity_binding_version&&item.browser_profile_ref===account.browser_profile_ref?'使用当前浏览器':'使用之前的浏览器'}</small></li>;})}</ol>:historyError?null:<p className="verification-note">{historyBusy?'正在读取历史…':'暂无验证历史。'}</p>}
   {cursor&&<button type="button" disabled={historyBusy} onClick={()=>void loadHistory(true)}>加载更多记录</button>}
  </details>
 </section>;
}
