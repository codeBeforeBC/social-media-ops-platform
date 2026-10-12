"""Local screenshot text only. Never infer identity, dates, units or confirmed metrics."""
import csv,io,json,math,subprocess,sys,warnings
from pathlib import Path
from PIL import Image,ImageOps
warnings.simplefilter('error',Image.DecompressionBombWarning)
Image.MAX_IMAGE_PIXELS=25000000
path=Path(sys.argv[1])
with Image.open(path) as image:
    image=ImageOps.exif_transpose(image)
    width,height=image.size
    # Give OCR a consistent display orientation and opaque background; original bytes remain untouched.
    rgba=image.convert('RGBA');background=Image.new('RGB',rgba.size,'white');background.paste(rgba,mask=rgba.getchannel('A'))
    prepared=path.parent/'ocr-input.png';background.save(prepared)
run=subprocess.run(['tesseract',str(prepared),'stdout','-l','chi_sim+eng','--psm','11','tsv'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=100,check=True)
if len(run.stdout)>20000000: raise ValueError('OCR_OUTPUT_LIMIT')
lines={};words=0;truncated=False
for row in csv.DictReader(io.StringIO(run.stdout.decode('utf-8')),delimiter='\t'):
    if row['level']!='5' or not row['text'].strip(): continue
    confidence=float(row['conf'])/100
    x,y,w,h=(int(row[k]) for k in ('left','top','width','height'))
    if not math.isfinite(confidence) or not 0<=confidence<=1 or min(x,y)<0 or min(w,h)<=0 or x+w>width or y+h>height: continue
    if words>=5000: truncated=True;break
    words+=1
    key=tuple(row[k] for k in ('page_num','block_num','par_num','line_num'))
    line=lines.setdefault(key,{'text':[],'confidence':1,'region':{'x':x,'y':y,'width':w,'height':h},'words':[]})
    line['words'].append({'text':row['text'][:1000],'confidence':confidence,'region':{'x':x,'y':y,'width':w,'height':h}})
    line['text'].append(row['text'][:1000]);line['confidence']=min(line['confidence'],confidence)
    box=line['region'];right=max(box['x']+box['width'],x+w);bottom=max(box['y']+box['height'],y+h)
    box['x']=min(box['x'],x);box['y']=min(box['y'],y);box['width']=right-box['x'];box['height']=bottom-box['y']
blocks=[{**line,'text':' '.join(line['text'])[:2000]} for line in lines.values()]
version=subprocess.run(['tesseract','--version'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5,check=True).stdout.decode('utf-8').splitlines()[0][:100]
print(json.dumps({'state':'ready' if blocks else 'no_text','engine':version,'languages':['chi_sim','eng'],'coordinate_space':'display_after_exif_orientation','width':width,'height':height,'blocks':blocks,'truncated':truncated},ensure_ascii=False))
