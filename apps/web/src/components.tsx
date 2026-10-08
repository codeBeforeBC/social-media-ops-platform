import React,{useEffect,useRef} from 'react';
export function Field({label,name,type='text',defaultValue,required=true,minLength}:{label:string;name:string;type?:string;defaultValue?:string;required?:boolean;minLength?:number}){
  return <label className="field"><span>{label}{required&&<span aria-hidden="true"> *</span>}</span><input name={name} type={type} defaultValue={defaultValue} required={required} minLength={minLength} autoComplete={type==='password'?'current-password':name==='email'?'email':'off'}/></label>;
}
export function Empty({title,children}:{title:string;children:React.ReactNode}){return <section className="empty"><span className="empty-icon" aria-hidden="true">◇</span><h2>{title}</h2><p>{children}</p></section>;}
export function Loading(){return <p role="status" className="loading">正在加载…</p>;}
export function ErrorState({error,retry}:{error:Error|null;retry?:()=>void}){if(!error)return null;return <div role="alert" className="error"><strong>{error.message}</strong>{'requestId'in error&&<small>请求编号：{String(error.requestId)}</small>}{retry&&<button onClick={retry}>重试</button>}</div>;}
const labels:Record<string,string>={queued:'等待处理',running:'处理中',succeeded:'已完成',partial:'部分完成',failed:'失败',cancelled:'已取消'};
export function JobStatus({state}:{state:string}){return <span className={'badge '+state}>{labels[state]??state}</span>;}
export function Drawer({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const prior=document.activeElement as HTMLElement|null;ref.current?.showModal();return ()=>{prior?.focus();};},[]);
  return <dialog ref={ref} aria-label={title} className="drawer" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===ref.current)onClose();}}><div className="drawer-heading"><h2>{title}</h2><button aria-label="关闭详情" onClick={onClose}>关闭</button></div>{children}</dialog>;
}
