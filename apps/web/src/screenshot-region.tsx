import React,{useEffect,useRef,useState} from 'react';
import {api} from './api';
import {ErrorState,Loading} from './components';
export type Region={x:number;y:number;width:number;height:number};
export function ScreenshotRegion({fileId,region,onChange}:{fileId:string;region?:Region;onChange?:(r:Region)=>void}){
 const [image,setImage]=useState<any>(null),[error,setError]=useState<Error|null>(null),anchor=useRef<{x:number;y:number}|null>(null);
 useEffect(()=>{let current=true;setImage(null);setError(null);void Promise.all([api('/files/'+fileId),api('/files/'+fileId+'/preview')]).then(([f,p])=>{if(current)setImage({url:p.url,width:f.metadata.width,height:f.metadata.height});}).catch(e=>{if(current)setError(e);});return()=>{current=false;};},[fileId]);
 if(error)return <ErrorState error={error}/>;if(!image)return <Loading/>;
 function point(e:React.PointerEvent<HTMLDivElement>){const box=e.currentTarget.getBoundingClientRect();return {x:Math.round(Math.max(0,Math.min(image.width,(e.clientX-box.left)/box.width*image.width))),y:Math.round(Math.max(0,Math.min(image.height,(e.clientY-box.top)/box.height*image.height)))};}
 function update(e:React.PointerEvent<HTMLDivElement>){if(!anchor.current||!onChange)return;const p=point(e),a=anchor.current,r={x:Math.min(a.x,p.x),y:Math.min(a.y,p.y),width:Math.abs(a.x-p.x),height:Math.abs(a.y-p.y)};if(r.width&&r.height)onChange(r);}
 return <section aria-label="截图区域核对"><p className="muted">{onChange?'在图中拖动选择指标区域，也可用下面四个坐标键盘输入。':'高亮区域是该行保留的来源；预览按原图比例显示。'}</p><div style={{position:'relative',maxWidth:800,touchAction:onChange?'none':undefined,userSelect:'none'}} onPointerDown={e=>{if(!onChange)return;anchor.current=point(e);e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={update} onPointerUp={e=>{update(e);anchor.current=null;}} onPointerCancel={()=>{anchor.current=null;}}>
 <img src={image.url} alt="私有导入原图预览" draggable={false} style={{display:'block',width:'100%',height:'auto'}}/>
 <svg aria-hidden="true" viewBox={`0 0 ${image.width} ${image.height}`} style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}}>{region&&<rect {...region} fill="rgba(245,158,11,0.18)" stroke="#c76a00" strokeWidth={2} vectorEffect="non-scaling-stroke"/>}</svg>
 </div>{onChange&&<div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8}}>{(['x','y','width','height'] as const).map((key,i)=><label className="field" key={key}>{['原图区域 X','原图区域 Y','原图区域宽度','原图区域高度'][i]}<input aria-label={['原图区域 X','原图区域 Y','原图区域宽度','原图区域高度'][i]} type="number" min={key==='width'||key==='height'?1:0} step="1" value={region?.[key]??''} onChange={e=>onChange({...region??{x:0,y:0,width:0,height:0},[key]:e.target.valueAsNumber||0})}/></label>)}</div>}</section>;
}
