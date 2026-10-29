import React,{useEffect,useState} from 'react';
import {api} from './api';
import {ErrorState} from './components';
const labels:Record<string,string>={stopping:'正在停止相关任务',backing_up:'正在保存删除前备份',purging:'正在清理账号记录',cleaning_files:'正在清理关联文件',completed:'删除已完成',failed:'删除尚未完成'};
const messages:Record<string,string>={DELETION_BACKUP_FAILED:'删除前备份未完成，原记录仍保留，请检查存储后重试。',DELETION_FILE_CLEANUP_FAILED:'账号登记已移除，但关联文件尚未全部清理，可继续重试。',DELETION_PLAN_CHANGED:'关联范围发生变化，已停止清理，请重试并重新核对。',DELETION_SHARED_REFERENCE:'发现共享或其他账号引用，已保留数据，请联系维护人员核对。',ACCOUNT_DELETE_FAILED:'清理未全部完成，已保存进度，可重试继续。'};
export function DeletionProgress({initial,onComplete}:{initial:any;onComplete?:()=>Promise<void>}){
 const [op,setOp]=useState(initial),[error,setError]=useState<Error|null>(null),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 useEffect(()=>{let stopped=false,timer:ReturnType<typeof setTimeout>;let current=initial;
  const poll=async()=>{try{current=await api('/account-deletions/'+initial.id);if(stopped)return;setOp(current);setError(null);if(current.state==='completed'){await onComplete?.();return;}if(['queued','running'].includes(current.job_state))timer=setTimeout(()=>void poll(),1000);}catch(e){if(!stopped){setError(e as Error);timer=setTimeout(()=>void poll(),5000);}}};
  if(initial.state!=='completed')timer=setTimeout(()=>void poll(),300);return()=>{stopped=true;clearTimeout(timer);};
 },[initial.id,reload]);
 const retry=async()=>{setBusy(true);setError(null);try{const next=await api('/account-deletions/'+op.id+'/retry',{method:'POST'});setOp(next);setReload(x=>x+1);}catch(e){setError(e as Error);}finally{setBusy(false);}};
 return <section className="account-delete-progress" aria-label="账号删除进度"><h3>{labels[op.state]??'正在处理删除'}</h3><p>提交于{new Date(op.created_at).toLocaleString('zh-CN')} · {op.account_name??'原账号登记已移除'}</p>
  {op.state!=='completed'&&<p>关闭页面后后台继续处理。文件清理完成前不会显示全部完成。</p>}
  {op.error_code&&<p role="alert">{messages[op.error_code]??'删除尚未完成，可检查运行状态后重试。'}</p>}
  <ErrorState error={error}/>{op.state==='failed'&&!['queued','running'].includes(op.job_state)&&<button disabled={busy} onClick={()=>void retry()}>继续重试删除</button>}
  {op.state==='completed'&&<p role="status">账号及其专属数据已删除，共享来源和其他账号保持。</p>}
  <p className="muted">{op.backup_available?'已保留删除前私有备份；页面不提供一键撤销。':'将先备份，再清理。未完成上传将中止，不恢复在途任务。'}</p>
 </section>;
}
