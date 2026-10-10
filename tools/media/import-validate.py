"""Validate import containers only; field mapping and metric confirmation belong to S7."""
import csv,io,json,sys,warnings,zipfile
from pathlib import PurePosixPath
from PIL import Image
warnings.simplefilter('error',Image.DecompressionBombWarning)
Image.MAX_IMAGE_PIXELS=25000000
path,output,mime=sys.argv[1:]
metadata={}
if mime in ('image/png','image/jpeg'):
    expected='PNG' if mime=='image/png' else 'JPEG'
    with Image.open(path) as image:
        if image.format!=expected: raise ValueError('IMAGE_TYPE_MISMATCH')
        image.verify()
    with Image.open(path) as image:
        image.load()
        metadata={'width':image.width,'height':image.height,'format':expected}
        image=image.convert('RGBA');image.thumbnail((1600,1600),Image.Resampling.LANCZOS);image.save(output,format='PNG')
elif mime=='text/csv':
    with open(path,'rb') as f: raw=f.read(52428801)
    if len(raw)>52428800 or b'\0' in raw: raise ValueError('CSV_INVALID')
    text=raw.decode('utf-8-sig',errors='strict')
    csv.field_size_limit(100000)
    rows=0
    for row in csv.reader(io.StringIO(text),strict=True):
        rows+=1
        if rows>100000 or len(row)>200: raise ValueError('CSV_LIMIT')
        # Imported cells are data; formulas must never be passed to spreadsheets for execution.
        if any(cell.lstrip().startswith(('=','+','@')) or (cell.lstrip().startswith('-') and not cell.strip().replace('-','',1).replace('.','',1).isdigit()) for cell in row): raise ValueError('CSV_FORMULA')
    if rows==0: raise ValueError('CSV_EMPTY')
    metadata={'format':'CSV','rows':rows}
elif mime=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    from xml.etree import ElementTree
    with zipfile.ZipFile(path) as archive:
        entries=archive.infolist();names=[i.filename for i in entries]
        if len(entries)>2000 or len(set(names))!=len(names) or sum(i.file_size for i in entries)>104857600: raise ValueError('XLSX_LIMIT')
        if not {'[Content_Types].xml','xl/workbook.xml'}.issubset(names): raise ValueError('XLSX_STRUCTURE')
        for entry in entries:
            name=entry.filename
            if name.startswith('/') or '\\' in name or '..' in PurePosixPath(name).parts or entry.flag_bits&1 or entry.compress_type not in (0,8) or (entry.file_size>1048576 and entry.file_size>max(entry.compress_size,1)*100): raise ValueError('XLSX_ENTRY')
            if any(part in name.lower() for part in ('vbaproject','macros','externallinks','embeddings','activex')): raise ValueError('XLSX_ACTIVE_CONTENT')
            if name.endswith(('.xml','.rels')):
                data=archive.read(entry)
                if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper(): raise ValueError('XLSX_ENTITY')
                root=ElementTree.fromstring(data)
                if any(n.tag.rsplit('}',1)[-1]=='f' or n.attrib.get('TargetMode')=='External' for n in root.iter()): raise ValueError('XLSX_FORMULA_OR_EXTERNAL')
                if name=='[Content_Types].xml' and any('macroenabled' in n.attrib.get('ContentType','').lower() for n in root): raise ValueError('XLSX_MACRO')
    metadata={'format':'XLSX','entries':len(entries)}
else: raise ValueError('UNSUPPORTED_IMPORT')
print(json.dumps(metadata))
