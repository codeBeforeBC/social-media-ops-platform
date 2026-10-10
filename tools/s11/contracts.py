"""Current independently registered notes and account-scoped import files."""
import json
from pathlib import Path
p=Path('contracts/openapi.json');spec=json.loads(p.read_text());S=spec['components']['schemas']
ref=lambda n:{'$ref':'#/components/schemas/'+n}
obj=lambda props,required:{'type':'object','properties':props,'required':required,'additionalProperties':False}
S['Publication']=obj({**S['PublicationCreate']['properties'],'id':ref('Id'),'workspace_id':ref('Id'),'recorded_by':ref('Id'),'lifecycle':{'enum':['active','deleted']},'version':{'type':'integer','minimum':1},'created_at':{'type':'string','format':'date-time'},'updated_at':{'type':'string','format':'date-time'}},list(S['PublicationCreate']['required'])+['id','workspace_id','recorded_by','lifecycle','version','created_at','updated_at'])
S['Publication']['properties']['title']={'type':['string','null']}
S['Publication']['properties']['media_type']={'enum':['graphic','video',None]}
S['UploadCreate']['allOf']=[{'if':{'properties':{'purpose':{'const':'import_table'}}},'then':{'properties':{'mime_hint':{'enum':['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']}}},'else':{'properties':{'size_bytes':{'maximum':20971520},'mime_hint':{'enum':['image/png','image/jpeg']}}}}]

S['UploadSession']={'type':'object','properties':{'id':ref('Id'),'account_id':ref('Id'),'purpose':S['UploadCreate']['properties']['purpose'],'size_bytes':{'type':'integer','minimum':1},'completed_parts':{'type':'array','items':{'type':'object'}},'part_size':{'type':'integer','minimum':1}},'required':['id','account_id','purpose','size_bytes','completed_parts','part_size'],'additionalProperties':True}
S['FileObject']={'type':'object','properties':{'id':ref('Id'),'account_id':ref('Id'),'purpose':S['UploadCreate']['properties']['purpose'],'size_bytes':{'type':'integer','minimum':1},'file_status':ref('FileStatus'),'preview_status':ref('PreviewStatus')},'required':['id','account_id','purpose','size_bytes','file_status','preview_status'],'additionalProperties':True}
S['UploadPartTarget']=obj({'part_number':{'type':'integer','minimum':1},'checksum':{'type':'string'},'etag':{'type':['string','null']},'upload_url':{'type':'string'},'method':{'const':'PUT'}},['part_number','checksum','etag','upload_url','method'])
S['Job']['allOf'][1]['properties']['pool']={'enum':['general','media']}
for path in ['/publications','/publications/{id}','/uploads','/uploads/{id}','/uploads/{id}/parts','/uploads/{id}/parts/{part_number}','/uploads/{id}/complete','/uploads/{id}/abort','/files/{id}/preview','/files/{id}/download']:
 for op in spec['paths'][path].values():op['x-implementation-status']='implemented'
op=spec['paths']['/uploads/{id}/parts']['post'];op['responses']['200']['content']['application/json']['schema']['properties']['data']=ref('UploadPartTarget')
op=spec['paths']['/uploads/{id}/parts/{part_number}']['put'];op['requestBody']={'required':True,'content':{'application/octet-stream':{'schema':{'type':'string','format':'binary'}}}};op['parameters']=[x for x in op['parameters'] if x['name']!='Idempotency-Key']
for x in op['parameters']:
 if x['name']=='part_number':x['schema']={'type':'integer','minimum':1}
# Private storage keys never form part of the wire model.
for name in ['FileObject','UploadSession']:
 S[name]['not']={'anyOf':[{'required':['object_key']},{'required':['storage_upload_id']}]}
spec['info']['description']='v1.2 三导航；implemented为实际接口，planned仅表示S7/S8等后续契约。'
p.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
