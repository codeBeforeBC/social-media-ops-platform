import React,{useEffect,useState} from 'react';
import {api} from './api';
import {Drawer,ErrorState,Empty,Loading} from './components';
export type AssetSelection={asset_id:string;asset_version_id:string;name:string;business_status:string};
export function AssetPicker({onSelect,onClose,excludeAssetId,title='选择素材'}:{onSelect:(selection:AssetSelection)=>void;onClose:()=>void;excludeAssetId?:string;title?:string}){
 const [items,setItems]=useState<any[]>([]),[query,setQuery]=useState(''),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<Error|null>(null);
 async function load(more=false){setBusy(true);setError(null);try{const r=await api('/assets?'+new URLSearchParams({limit:'20',...(query?{q:query}:{}),...(more&&cursor?{cursor}: {})}));setItems(old=>more?[...old,...r.items]:r.items);setCursor(r.next_cursor);}catch(e){setError(e as Error);}finally{setBusy(false);}}
 useEffect(()=>{void load();},[]);
 return <Drawer title={title} onClose={onClose}><form onSubmit={e=>{e.preventDefault();void load();}}><label>搜索素材<input value={query} onChange={e=>setQuery(e.target.value)}/></label><button>搜索</button></form><ErrorState error={error} retry={()=>void load()}/>{busy&&<Loading/>}{items.filter(a=>a.id!==excludeAssetId).map(a=><article className="version-row" key={a.id}><h3>{a.name}</h3><p>{a.business_status==='retired'?'已停用，不能新增引用':a.business_status==='pending_confirmation'?'使用范围待确认':'已确认可用'}</p><button disabled={a.business_status==='retired'} onClick={()=>onSelect({asset_id:a.id,asset_version_id:a.current_version_id,name:a.name,business_status:a.business_status})}>选择此版本</button></article>)}{!busy&&!items.some(a=>a.id!==excludeAssetId)&&<Empty title="暂无可选素材">可以调整搜索条件或上传其他素材。</Empty>}{cursor&&<button disabled={busy} onClick={()=>void load(true)}>加载更多</button>}</Drawer>;
}
