import React,{useState} from 'react';
import {api} from './api';
import {Drawer,ErrorState,Field} from './components';
import {BrowserProfileInput} from './account-verification';
import {xhsAccountIdentity} from '../../../packages/domain/src/xhs-account';

type SourceKind='weibo_hot'|'xhs_topic_signal'|'xhs_quality_note';
export const sourceKinds:Record<string,string>={weibo_hot:'微博热搜榜',xhs_topic_signal:'小红书话题搜索',xhs_quality_note:'小红书参考笔记'};
const descriptions:Record<SourceKind,string>={weibo_hot:'读取微博公开热搜榜的标题和热度，无需浏览器登录或搜索词。',xhs_topic_signal:'使用已登录小红书的浏览器，按关键词搜索较新的笔记列表，作为话题线索。',xhs_quality_note:'综合搜索相关笔记，并尝试读取部分正文；也可额外参考指定账号的公开笔记。'};
export function SourceCreateDialog({onClose,onCreated}:{onClose:()=>void;onCreated:()=>Promise<void>}){
 const [kind,setKind]=useState<SourceKind>('weibo_hot'),[profile,setProfile]=useState(''),[keywords,setKeywords]=useState(''),[references,setReferences]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<Error|null>(null);
 const xhs=kind!=='weibo_hot';
 async function save(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return;setError(null);const name=String(new FormData(e.currentTarget).get('name')??'').trim();
  if(!name){setError(new Error('请填写来源名称，方便在列表中识别。'));return;}
  const config:{profile?:string;keywords?:string[];reference_accounts?:string[]}={};
  if(xhs){
   const words=[...new Set(keywords.split(/[，,、\r\n]+/).map(s=>s.trim()).filter(Boolean))];
   if(!words.length){setError(new Error('至少填写1个搜索关键词。'));return;}
   if(words.length>10||words.some(w=>w.length>100)){setError(new Error('最多填写10个关键词，每个不超过100个字符，请删减或缩短。'));return;}
   if(!profile){setError(new Error('请选择已登录小红书的浏览器。'));return;}
   config.profile=profile;config.keywords=words;
   if(kind==='xhs_quality_note'){
    const rows=references.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if(rows.length>2){setError(new Error('最多添加2个参考账号，请每行填写一个个人主页。'));return;}
    const ids=rows.map((row,index)=>{const identity=xhsAccountIdentity(row);if(!identity)throw new Error(`第${index+1}个参考账号不是有效的个人主页。请粘贴完整小红书个人主页链接，或填写主页中的24位ID。`);return identity.id;});
    if(new Set(ids).size!==ids.length){setError(new Error('参考账号重复了，请每个账号只保留一次。'));return;}
    if(ids.length)config.reference_accounts=ids;
   }
  }
  setBusy(true);
  try{await api('/source-connections',{method:'POST',body:{name,source_type:kind,platform:xhs?'xiaohongshu':'weibo',provider:xhs?'opencli':'weibo_web',enabled:false,config}});await onCreated();}
  catch(e){setError(e as Error);}finally{setBusy(false);}
 }
 return <Drawer title="添加来源" className="source-create-drawer" closeDisabled={busy} onClose={onClose}>
  <div className="source-create-feedback"><ErrorState error={error}/></div>
  <form id="source-create-form" onSubmit={e=>{void save(e).catch(err=>setError(err as Error));}}>
   <div className="source-create-scroll"><fieldset disabled={busy}>
    <label className="field"><span>来源类型</span><select name="kind" value={kind} onChange={e=>{setKind(e.target.value as SourceKind);setError(null);}}>{Object.entries(sourceKinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <p className="source-create-purpose">{descriptions[kind]}</p>
    <Field label="来源名称" name="name"/><p className="source-create-note">仅用于工作台识别，例如“微博热搜”或“旅行参考”。</p>
    {xhs&&<section className="source-create-config" aria-label="小红书采集设置">
     <BrowserProfileInput required name="profile" value={profile} onChange={setProfile} label="采集使用的浏览器" description="选择已登录小红书的浏览器，工作台会用它读取公开内容。列表里的短代码是浏览器连接标识，不是小红书账号ID；列表为空时，请打开浏览器并启用连接插件，再刷新列表。"/>
     <label className="field"><span>搜索关键词 <span aria-hidden="true">*</span></span><textarea name="keywords" value={keywords} onChange={e=>setKeywords(e.target.value)} rows={2} required placeholder="例如：城市漫步, 潮玩开箱" aria-describedby="source-keyword-help"/></label>
     <p className="source-create-note" id="source-keyword-help">{kind==='xhs_topic_signal'?'按这些词逐个搜索，优先寻找较新的话题线索。':'按这些词逐个综合搜索，并尝试读取部分笔记正文。'}用逗号、顿号或换行分隔，最多10个；实际结果以采集记录为准。</p>
     {kind==='xhs_quality_note'&&<div className="source-create-references"><label className="field"><span>参考账号主页（选填）</span><textarea name="references" value={references} onChange={e=>setReferences(e.target.value)} rows={3} placeholder="每行一个小红书个人主页链接，最多2个" aria-describedby="source-reference-help"/></label><p className="source-create-note" id="source-reference-help">额外读取这些账号的公开笔记，不按搜索关键词过滤；不会加入你的运营账号列表。</p><p className="source-create-note">每行粘贴一个完整个人主页链接，最多2个，也支持主页中的24位ID。昵称、小红书号和笔记链接不适用。</p></div>}
    </section>}
    <div className="source-create-schedule"><h3>添加后怎么用</h3><p>先保存配置，再到列表点击“立即采集”获取线索。</p><p>定时采集默认关闭，启用后每天09:00、16:00（北京时间）运行。</p></div>
   </fieldset></div>
  </form>
  <div className="source-create-footer"><p>添加后不会立即采集</p><button className="primary" form="source-create-form" disabled={busy} aria-busy={busy}>{busy?'正在添加…':'添加来源'}</button></div>
 </Drawer>;
}
