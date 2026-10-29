import React,{useEffect,useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {DeletionProgress} from './account-deletions';
import {api,ApiError} from './api';
import {BrowserProfileInput,VerificationPanel} from './account-verification';
import {xhsAccountIdentity} from '../../../packages/domain/src/xhs-account';
import {Field,Empty,Loading,ErrorState,Drawer,JobStatus} from './components';
import './style.css';
import {BudgetSettings,Monitor} from './operations';
import {Home} from './home';
import {Sources} from './sources';
import {PublicationsPanel} from './publications';
import type {InstanceData} from '../../../packages/contracts/src/types';
type Me=InstanceData;
const navigation=[['home','工作台','◫'],['topics','选题策划','✧'],['reports','数据复盘','↗']];
function App(){
  const [me,setMe]=useState<Me|null>(null),[error,setError]=useState<Error|null>(null),[loading,setLoading]=useState(true);
  const refresh=async()=>{setLoading(true);setError(null);try{setMe(await api('/instance'));}catch(e){setError(e as Error);}finally{setLoading(false);}};
  useEffect(()=>{void refresh();},[]);
  if(loading)return <main className="auth"><Loading/></main>;
  if(!me)return <main className="auth"><h1>工作台暂不可用</h1><ErrorState error={error} retry={()=>void refresh()}/></main>;
  return <Shell me={me}/>;
}
function Shell({me}:{me:Me}){
  const [route,setRoute]=useState(location.hash.slice(1)||'home'),[drawer,setDrawer]=useState<'notifications'|null>(null),[error,setError]=useState<Error|null>(null);
  const [removed,setRemoved]=useState(false);
  useEffect(()=>{const change=()=>{const target=location.hash.slice(1)||'home';if(!['home','topics','reports','settings'].includes(target.split('?')[0]!)||new URLSearchParams(target.split('?')[1]).get('tab')==='members'){history.replaceState(null,'','#home');setRoute('home');setRemoved(true);}else{setRoute(target);setRemoved(false);}};change();window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  const title=navigation.find(n=>n[0]===route.split('?')[0])?.[1]??'工作区设置';
  return <div className="layout"><a className="skip" href="#main-content" onClick={e=>{e.preventDefault();document.getElementById('main-content')?.focus();}}>跳到主要内容</a><aside className="sidebar"><a href="#home" className="brand"><span className="logo">Y</span><span>YOYO<small>运营工作台</small></span></a><div className="workspace-label">{me.workspace.name}</div><nav aria-label="主导航">{navigation.map(([key,label,icon])=><a key={key} href={'#'+key} aria-current={key===route.split('?')[0]?'page':undefined}><span aria-hidden="true">{icon}</span>{label}</a>)}</nav><div className="sidebar-bottom"><a href="#settings" aria-current={route.split('?')[0]==='settings'?'page':undefined}>⚙ 工作区设置</a><p>创意有序，协作可追溯</p></div></aside><div className="body"><header><div className="breadcrumb">工作区 / <strong>{title}</strong></div><div className="header-actions"><button onClick={()=>setDrawer('notifications')}>通知</button></div></header><main id="main-content" tabIndex={-1}><ErrorState error={error}/>{removed&&<p role="status">此模块已移除，已返回工作台。</p>}{route.split('?')[0]==='home'?<Home me={me}/>:route.split('?')[0]==='settings'?<Settings key={route} me={me}/>:route.split('?')[0]==='topics'?<Sources key={route} me={me}/>:route.split('?')[0]==='reports'?<PublicationsPanel key={route} me={me}/>:<ModulePlaceholder/>}</main><footer>YOYO · {me.workspace.timezone} · 运营工作台</footer></div>{drawer==='notifications'&&<Drawer title="通知中心" onClose={()=>setDrawer(null)}><Notifications onNavigate={()=>setDrawer(null)}/></Drawer>}</div>;
}
function ModulePlaceholder(){return <Empty title="请通过导航进入工作台">选择工作台、选题策划或数据复盘。</Empty>;}

function Settings({me}:{me:Me}){
  const [tab,setTab]=useState(new URLSearchParams(location.hash.split('?')[1]).get('tab')??'workspace');const tabs=[['workspace','工作区'],['budget','产能与预算'],['accounts','运营账号'],['jobs','后台任务'],['monitor','运行状态'],['audit','审计记录']];
  return <><div className="page-heading"><div><p className="eyebrow">工作区与运行</p><h1>工作区设置</h1></div></div><nav className="tabs" aria-label="设置分类">{tabs.map(([k,t])=><button key={k} aria-current={tab===k?'page':undefined} onClick={()=>setTab(k!)}>{t}</button>)}</nav>{tab==='workspace'?<WorkspaceSettings editable={true}/>:tab==='budget'&&true?<BudgetSettings/>:tab==='accounts'?<Accounts editable={true} admin={true}/>:tab==='jobs'?<JobList admin={true}/>:<DataList key={tab} path={tab==='monitor'?'/monitor':'/audit-logs'} title={tab==='monitor'?'运行状态':'审计记录'}/>}</>;
}
function useData(path:string){const [data,setData]=useState<any>(null),[error,setError]=useState<Error|null>(null),[loading,setLoading]=useState(true);async function refresh(){setLoading(true);setError(null);try{setData(await api(path));}catch(e){setError(e as Error);}finally{setLoading(false);}}useEffect(()=>{void refresh();},[path]);async function more(){if(!data?.next_cursor)return;setError(null);try{const r=await api(path+(path.includes('?')?'&':'?')+'cursor='+encodeURIComponent(data.next_cursor));setData({...r,items:[...data.items,...r.items]});}catch(e){setError(e as Error);}}return {data,error,loading,refresh,more};}
function WorkspaceSettings({editable}:{editable:boolean}){
  const {data,error,loading,refresh}=useData('/settings');const [failure,setFailure]=useState<Error|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  if(loading)return <Loading/>;if(error)return <ErrorState error={error} retry={()=>void refresh()}/>;
  return <section className="panel narrow"><h2>工作区信息</h2><ErrorState error={failure}/>{notice&&<p role="status">{notice}</p>}<form onSubmit={async e=>{e.preventDefault();setBusy(true);setFailure(null);const f=new FormData(e.currentTarget);try{await api('/settings',{method:'PATCH',body:{category:'workspace',settings:{name:f.get('name'),timezone:f.get('timezone')},expected_version:data.version}});setNotice('已保存');await refresh();}catch(e){setFailure(e as Error);}finally{setBusy(false);}}}><fieldset disabled={!editable||busy}><Field label="名称" name="name" defaultValue={data.name}/><Field label="时区" name="timezone" defaultValue={data.timezone}/>{editable&&<button className="primary" disabled={busy}>保存设置</button>}</fieldset></form>{!editable&&<p className="muted">当前角色可查看设置，修改由管理员操作。</p>}</section>;
}
function Accounts({editable,admin}:{editable:boolean;admin:boolean}){
  const {data,error,loading,refresh}=useData('/accounts');const deletionList=useData('/account-deletions');
  const [selected,setSelected]=useState<any>(null),[creating,setCreating]=useState(false),[failure,setFailure]=useState<Error|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[deleteMode,setDeleteMode]=useState(false),[deleteKey,setDeleteKey]=useState(''),[impact,setImpact]=useState<any>(null),[impactLoading,setImpactLoading]=useState(false),[deletion,setDeletion]=useState<any>(null);
  const deleteFeedback=useRef<HTMLDivElement>(null);const deleteTarget=useRef<string|null>(null);
  const deleting=useRef(deleteMode);
  useEffect(()=>{deleting.current=deleteMode;},[deleteMode]);
  useEffect(()=>{if(deleteMode&&failure){deleteFeedback.current?.focus({preventScroll:true});deleteFeedback.current?.scrollIntoView({block:'nearest'});}},[deleteMode,failure]);
  const duplicateId=failure instanceof ApiError&&failure.code==='ACCOUNT_EXISTS'?failure.fields.account_id:null;
  const profile=(a:any)=>a.platform==='xiaohongshu'?xhsAccountIdentity(a.platform_user_id):null;
  const open=(a:any)=>{setSelected(a);setCreating(false);setFailure(null);setNotice('');setDeleteMode(false);setImpact(null);setDeletion(null);deleteTarget.current=null;};
  const close=()=>{setSelected(null);setCreating(false);setFailure(null);setDeleteMode(false);setImpact(null);setDeletion(null);deleteTarget.current=null;};
  const loadImpact=async(a:any)=>{setImpactLoading(true);setFailure(null);try{const next=await api(`/accounts/${a.id}/deletion-impact`);if(deleteTarget.current!==a.id)return;setImpact(next);if(next.operation)setDeletion(next.operation);else if(next.expected_version!==a.version)setFailure(new ApiError('VERSION_CONFLICT','账号已修改，请读取最新账号后重新确认','',409));}catch(e){if(deleteTarget.current===a.id)setFailure(e as Error);}finally{if(deleteTarget.current===a.id)setImpactLoading(false);}};
  const beginDelete=(a:any)=>{open(a);deleteTarget.current=a.id;setDeleteMode(true);setDeleteKey(crypto.randomUUID());void loadImpact(a);};
  const deletionDone=async()=>{close();setNotice('账号已从工作区删除；专属关联数据清理完成，删除前备份已保留。');await refresh();await deletionList.refresh();};
  const remove=async()=>{if(busy||!impact?.fingerprint||deletion)return;setBusy(true);setFailure(null);setNotice('');try{const r=await api('/accounts/'+selected.id,{method:'DELETE',body:{expected_version:selected.version,confirmed:true,force:true,fingerprint:impact.fingerprint},key:deleteKey});setDeletion(r.operation);setNotice('删除请求已提交，正在停止任务和清理专属数据');await refresh();await deletionList.refresh();}catch(e){setFailure(e as Error);}finally{setBusy(false);}};
  const reloadSelected=async()=>{const current=await api('/accounts/'+selected.id);setSelected((old:any)=>old?.id===current.id?current:old);if(!deleting.current)setFailure(null);await refresh();};
  async function save(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(busy)return;
    setFailure(null);setNotice('');const f=new FormData(e.currentTarget),verifyAfter=(e.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='verify';
    if(creating&&!xhsAccountIdentity(f.get('platform_user_id'))){setFailure(new Error('请输入24位小红书内部账号ID或完整官方主页链接；昵称、小红书号和笔记链接不能代替内部ID'));return;}
    setBusy(true);
    try{
      const body=creating?{platform:'xiaohongshu',platform_user_id:f.get('platform_user_id'),name:f.get('name'),timezone:f.get('timezone'),...(f.get('browser_profile_ref')?{browser_profile_ref:f.get('browser_profile_ref')}:{})}:{name:f.get('name'),timezone:f.get('timezone'),expected_version:selected.version};
      const saved=await api(creating?'/accounts':'/accounts/'+selected.id,{method:creating?'POST':'PATCH',body});
      setSelected(creating?saved:{...saved,verification:selected.verification});setCreating(false);setNotice(creating?'账号已保存，尚未验证平台身份。保存不会登录小红书或开启采集。':'账号已保存，身份核验状态见下方。');
      if(verifyAfter){try{const accepted=await api(`/accounts/${saved.id}/verifications`,{method:'POST',body:{expected_version:saved.version,binding_version:saved.identity_binding_version}});saved.verification={latest:accepted.verification,last_success:null,current:true,stale:true,confirmed:false};setSelected({...saved});setNotice('账号已保存，验证请求已提交，正在等待实际结果');}catch(e){setNotice('账号已保存，但验证未提交，可在核验区重试');setFailure(e as Error);}}
      try{setSelected(await api('/accounts/'+saved.id));}catch(e){setFailure(e as Error);}await refresh();
    }catch(e){setFailure(e as Error);}finally{setBusy(false);}
  }
  return <section className="panel"><div className="panel-heading"><h2>小红书运营账号</h2>{admin&&<button className="primary" onClick={()=>{setCreating(true);setSelected(null);setFailure(null);setNotice('');setDeleteMode(false);}}>添加账号</button>}</div>
    <p className="muted">保存仅登记账号；公开身份、当前登录身份与人工管理确认分别展示，核验只代表所示观察时间。</p>
    <ErrorState error={error} retry={()=>void refresh()}/><ErrorState error={deletionList.error} retry={()=>void deletionList.refresh()}/>{notice&&!selected&&!creating&&<p role="status">{notice}</p>}
    {deletionList.data?.items.length>0&&<section aria-label="删除操作记录">{deletionList.data.items.map((op:any)=><DeletionProgress key={op.id} initial={op} onComplete={async()=>{await refresh();await deletionList.refresh();}}/>)}</section>}
    {loading?<Loading/>:data?.items.length?<div className="table-wrap account-table" role="region" aria-label="运营账号列表，可横向滚动" tabIndex={0}><table><thead><tr><th>账号 / 本地备注</th><th>账号标识</th><th>登记与核验</th><th>操作</th></tr></thead><tbody>{data.items.map((a:any)=><tr key={a.id}><td>{a.name}{a.platform!=='xiaohongshu'&&<small>历史账号 · {a.platform}</small>}</td><td><span className="account-id">{a.platform_user_id}</span><small>{a.display_handle?'展示号：'+a.display_handle:'未提供展示号'}</small></td><td><span className="badge">已登记</span><small>{a.platform!=='xiaohongshu'?'仅保留历史记录':a.verification?.current&&a.verification.latest?.result?.public_status==='matched'?(a.verification.stale?'历史身份匹配 · 需重新验证':'公开身份已匹配'):'身份未验证'}</small></td><td>{a.verification?.latest&&<JobStatus state={a.verification.latest.state}/>}<button onClick={()=>open(a)}>查看{editable?' / 编辑':''}</button>{admin&&<button disabled={busy} aria-label={'删除账号：'+a.name} onClick={()=>beginDelete(a)}>删除</button>}</td></tr>)}</tbody></table></div>:<Empty title="还没有运营账号">登记小红书主页链接或内部账号ID；保存不会自动登录平台或开启采集。</Empty>}
    {(selected||creating)&&<Drawer title={creating?'添加小红书运营账号':'账号详情'} className="account-detail" onClose={close} closeDisabled={busy}>
      {notice&&<p role="status">{notice}</p>}<ErrorState error={deleteMode?null:failure}/>
      {typeof duplicateId==='string'&&<button onClick={()=>void api('/accounts/'+duplicateId).then(open).catch(e=>setFailure(e as Error))}>查看已有账号</button>}
      {!creating&&<><dl><dt>平台</dt><dd>{selected.platform==='xiaohongshu'?'小红书':'历史账号（'+selected.platform+'）'}</dd><dt>平台内部账号 ID（只读）</dt><dd className="account-id">{selected.platform_user_id}</dd><dt>展示号（不能替代内部ID）</dt><dd>{selected.display_handle||'未提供'}</dd><dt>登记与核验</dt><dd>{selected.platform==='xiaohongshu'?'已登记，身份核验和登录结果见下方':'仅保留历史记录，不提供账号验证'}</dd></dl>
        <div className="actions"><button onClick={()=>void navigator.clipboard.writeText(selected.platform_user_id).then(()=>setNotice('内部账号ID已复制')).catch(()=>setFailure(new Error('无法复制，请选中上方完整ID手动复制')))}>复制内部账号ID</button>{profile(selected)&&<a className="button" href={profile(selected)!.profile_url} target="_blank" rel="noopener noreferrer">打开小红书主页</a>}</div>
        <p className="muted">主页链接按内部ID生成，能打开主页不代表已验证身份或登录。请核对主页账号；内部ID不能在普通编辑中更换。{selected.platform==='xiaohongshu'&&!profile(selected)&&'此历史ID不符合当前格式，请先人工核对。'}</p>
      </>}
      {!creating&&selected.platform==='xiaohongshu'&&<div hidden={deleteMode}><VerificationPanel key={'verification:'+selected.id} account={selected} onRefresh={reloadSelected}/></div>}
      <form hidden={deleteMode} key={creating?'new':'account-form:'+selected.id} onSubmit={e=>void save(e)}><fieldset disabled={!editable||busy}>
        {creating&&<><p>平台：小红书</p><Field label="小红书主页链接或内部账号 ID" name="platform_user_id"/><p className="muted">打开小红书个人主页，复制完整主页链接，或填写主页路径中的24位内部ID。昵称、小红书号及笔记链接不适用；短链接请先在浏览器打开后复制完整主页地址。</p></>}
        {creating&&<BrowserProfileInput/>}
        <Field label="本地备注名称" name="name" defaultValue={selected?.name}/><Field label="时区" name="timezone" defaultValue={selected?.timezone??'Asia/Shanghai'}/>
        <p className="muted">本地备注用于工作区识别，不是平台返回昵称。保存账号不会自动验证或登录。</p>
        {editable&&<div className="actions"><button className="primary" value="save">{busy?'保存中…':creating?'保存账号':'保存修改'}</button>{creating&&<button value="verify">保存并验证</button>}</div>}
      </fieldset></form>
      {!creating&&admin&&<section className="account-delete" aria-label="删除账号确认">
        {deleteMode?<><h3>确认删除账号及关联数据</h3><p>账号：<strong>{selected.name||'未命名账号'}</strong></p><p className="account-id">内部ID：{selected.platform_user_id}</p>
          {deletion?<DeletionProgress initial={deletion} onComplete={deletionDone}/>:<><p>将永久删除该账号及其专属选题、任务、笔记登记、指标、验证记录和文件。只操作本地数据，不删除小红书平台账号；共享来源、其他账号及配置保持。</p><p className="account-warning">此操作会先停止任务并保留删除前备份，页面不提供一键撤销。关联记录仅作警告，不阻止清理。</p>
          {impactLoading?<p role="status">正在核对删除影响…</p>:impact?.counts&&<ul aria-label="将删除的关联记录">{Object.entries(impact.counts).map(([label,count])=><li key={label}>{label}：{String(count)}</li>)}</ul>}
          {impact?.file_count>0&&<p>关联文件：{impact.file_count}，将备份后清理；未完成上传会中止。</p>}
          <button disabled={busy||impactLoading} onClick={()=>void loadImpact(selected)}>刷新删除影响</button>
          {failure&&<div ref={deleteFeedback} tabIndex={-1}><ErrorState error={failure}/></div>}
          {failure instanceof ApiError&&failure.code==='VERSION_CONFLICT'&&<button disabled={busy} onClick={()=>{setBusy(true);void api('/accounts/'+selected.id).then(current=>{setSelected(current);setFailure(null);setNotice('已读取最新账号，请重新核对后确认');void loadImpact(current);}).catch(e=>setFailure(e as Error)).finally(()=>setBusy(false));}}>读取最新账号后重新确认</button>}
          <div className="actions"><button className="danger-button" disabled={busy||impactLoading||!impact?.fingerprint||impact.expected_version!==selected.version} onClick={()=>void remove()}>{busy?'正在提交删除…':'确认删除账号及关联数据'}</button><button disabled={busy} onClick={()=>{setDeleteMode(false);deleteTarget.current=null;setImpact(null);setFailure(null);}}>取消删除</button></div></>}
        </>:<><h3>删除本地登记</h3><p className="muted">删除前会列出关联数据，确认后将一并清理该账号的专属记录。</p><button disabled={busy} className="danger-button" onClick={()=>beginDelete(selected)}>删除账号</button></>}
      </section>}
    </Drawer>}
  </section>;
}
function Notifications({onNavigate}:{onNavigate:()=>void}){const {data,error,loading,refresh}=useData('/notifications');return <><ErrorState error={error} retry={()=>void refresh()}/>{loading?<Loading/>:data?.items.length?<ul className="notification-list">{data.items.map((n:any)=><li key={n.id}><h3>{n.title}</h3><p>{new Date(n.created_at).toLocaleString('zh-CN')}</p><span>{n.superseded_at?'已失效':n.read_at?'已读':'未读'}</span>{!n.superseded_at&&n.task_ref&&<a onClick={onNavigate} href={n.task_ref.startsWith('source-organization:')?'#topics?organization_id='+n.task_ref.slice(20):n.task_ref.startsWith('source:')?'#topics?source_id='+n.task_ref.slice(7):n.task_ref.startsWith('topic:')?'#topics':n.task_ref.startsWith('job:')?'#settings?tab=jobs':'#reports'}>查看相关事项</a>}{!n.read_at&&<button onClick={async()=>{await api('/notifications/'+n.id+'/read',{method:'POST'});await refresh();}}>标为已读</button>}</li>)}</ul>:<Empty title="暂无通知">任务结果与需要处理的事项会出现在这里。</Empty>}</>;}
function JobList({admin}:{admin:boolean}){
  const [filter,setFilter]=useState('');const {data,error,loading,refresh,more}=useData('/jobs'+(filter?'?state='+filter:''));const [failure,setFailure]=useState<Error|null>(null),[busy,setBusy]=useState(false),[selected,setSelected]=useState<any>(null);
  async function act(fn:()=>Promise<unknown>){setFailure(null);setBusy(true);try{await fn();await refresh();}catch(e){setFailure(e as Error);}finally{setBusy(false);}}
  return <section className="panel"><div className="panel-heading"><h2>后台任务</h2><label>任务状态<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">全部</option><option value="failed">失败</option><option value="queued">等待</option><option value="running">运行中</option><option value="succeeded">成功</option></select></label><div className="actions"><button disabled={busy} onClick={()=>void refresh()}>刷新</button>{admin&&<button className="primary" disabled={busy} onClick={()=>void act(()=>api('/diagnostics',{method:'POST',body:{pool:'general'}}))}>运行检查</button>}</div></div><ErrorState error={failure??error}/>{loading?<Loading/>:data?.items.length?<div className="table-wrap"><table><thead><tr><th>任务</th><th>状态</th><th>执行池</th><th>尝试</th><th>操作</th></tr></thead><tbody>{data.items.map((j:any)=><tr key={j.id}><td>{j.type}</td><td><JobStatus state={j.state}/></td><td>{j.pool}</td><td>{j.attempts}</td><td><button onClick={()=>setSelected(j)}>详情</button>{['queued','running'].includes(j.state)&&j.type!=='account.delete'&&<button disabled={busy} onClick={()=>void act(()=>api('/jobs/'+j.id+'/cancel',{method:'POST',body:{reason:'用户取消'}}))}>取消</button>}{['account.verify','account.delete'].includes(j.type)&&['failed','partial'].includes(j.state)&&<a href="#settings?tab=accounts">{j.type==='account.delete'?'去运营账号继续删除':'去运营账号重新验证'}</a>}{admin&&j.state==='failed'&&!['account.verify','account.delete'].includes(j.type)&&<button disabled={busy} onClick={()=>void act(()=>api('/jobs/'+j.id+'/retry',{method:'POST',body:{reason:'管理员重试'}}))}>重试</button>}</td></tr>)}</tbody></table></div>:<Empty title="暂无后台任务">运行检查可验证持久任务链路。任务状态由服务端返回。</Empty>}{data?.next_cursor&&<button onClick={()=>void more()}>更多任务</button>}{selected&&<Drawer title="任务详情" onClose={()=>setSelected(null)}><JobStatus state={selected.state}/><dl><dt>任务编号</dt><dd>{selected.id}</dd><dt>错误代码</dt><dd>{selected.error_code??'无'}</dd><dt>请求编号</dt><dd>{selected.request_id}</dd></dl><p className="muted">失败不会覆盖业务输入；输入版本过期的结果会被拒绝。</p></Drawer>}</section>;
}
function DataList({path,title}:{path:string;title:string}){const {data,error,loading,refresh,more}=useData(path);return <section className="panel"><div className="panel-heading"><h2>{title}</h2><button onClick={()=>void refresh()}>刷新</button></div><ErrorState error={error} retry={()=>void refresh()}/>{loading?<Loading/>:error?null:path==='/monitor'?<Monitor data={data}/>:data?.items.length?<div className="table-wrap"><table><thead><tr><th>时间</th><th>动作</th><th>对象</th><th>请求编号</th></tr></thead><tbody>{data.items.map((a:any)=><tr key={a.id}><td>{new Date(a.occurred_at).toLocaleString('zh-CN')}</td><td>{a.action}</td><td>{a.object_type}</td><td className="mono">{a.request_id}</td></tr>)}</tbody></table></div>:<Empty title="暂无记录">关键写操作以追加方式记录，凭据不会进入审计内容。</Empty>}{data?.next_cursor&&<button onClick={()=>void more()}>更多审计记录</button>}</section>;}
createRoot(document.getElementById('root')!).render(<App/>);
