import json,copy
from pathlib import Path
p=Path('contracts/openapi.json');spec=json.loads(p.read_text());schemas=spec['components']['schemas']
ref=lambda n:{'$ref':'#/components/schemas/'+n}
nullable=lambda n:{'anyOf':[ref(n),{'type':'null'}]}
for name,changes in {
 'UploadSession':{'part_size':{'type':'integer','minimum':1},'completed_parts':{'type':'array','items':{'type':'object'}},'size_bytes':{'type':'integer','minimum':1}},
 'Folder':{'parent_id':nullable('Id')},
 'AssetVersion':{'dependencies':{'type':'array','items':ref('Id')}},
 'AssetUsage':{'permission_snapshot':{'type':'object'}},
 'BrandRuleSet':{'activated_by':nullable('Id')},
 'BrandRule':{'source_page':{'type':'integer','minimum':1},'uncertainty_note':{'type':['string','null']}},
}.items():
 obj=schemas[name].get('allOf',[{},schemas[name]])[-1];obj.setdefault('properties',{}).update(changes)
schemas['Download']['properties']['file_id']=ref('Id')
schemas['UploadPartTarget']={'type':'object','properties':{'part_number':{'type':'integer','minimum':1},'checksum':{'type':'string','pattern':'^[a-f0-9]{64}$'},'etag':{'type':['string','null']},'upload_url':{'type':'string','pattern':'^/api/v1/uploads/'},'method':{'const':'PUT'}},'required':['part_number','checksum','etag','upload_url','method'],'additionalProperties':False}
spec['paths']['/uploads/{id}/parts']['post']['responses']['200']['content']['application/json']['schema']['properties']['data']=ref('UploadPartTarget')
implemented={'/uploads':['post'],'/uploads/{id}':['get'],'/uploads/{id}/parts':['post'],'/uploads/{id}/complete':['post'],'/uploads/{id}/abort':['post'],'/assets':['get','post'],'/assets/{id}':['get','patch'],'/assets/{id}/versions':['get','post'],'/assets/{id}/retire':['post'],'/asset-versions/{id}/confirm':['post'],'/assets/{id}/usages':['get'],'/assets/{id}/favorite':['put','delete'],'/files/{id}/download':['get'],'/files/{id}/preview':['get'],'/folders':['get','post'],'/folders/{id}':['get','patch'],'/rule-sets':['get','post'],'/rule-sets/{id}':['get'],'/rule-sets/{id}/activate':['post'],'/asset-usages':['post'],'/asset-relations':['get','post']}
for path,methods in implemented.items():
 for m in methods:spec['paths'][path][m]['x-implementation-status']='implemented'
# Original broad enums remain for historical S0 examples; v1 writes enforce narrowed asset categories.
for n in ['AssetCreate','AssetPatch']:
 schemas[n]['properties']['category']={'type':'string','enum':['2d','render']}
schemas['UploadCreate']['properties']['purpose']={'type':'string','enum':['asset','guideline']}
schemas['AssetVersionCreate']['properties'].update({'valid_until':{'type':['string','null'],'format':'date-time'},'software':{'type':'string','maxLength':200}})
spec['paths']['/assets/{id}/favorite']['put']['responses']['200']['content']['application/json']['schema']['properties']['data']={'type':'object','properties':{'success':{'type':'boolean'}},'required':['success'],'additionalProperties':False}
base=copy.deepcopy(spec['paths']['/uploads/{id}/parts']['post']);base['operationId']='put_upload_part_bytes';base['summary']='校验并写入二进制分片';base['requestBody']={'required':True,'content':{'application/octet-stream':{'schema':{'type':'string','format':'binary'}}}};base['parameters']=[{'name':'X-CSRF-Token','in':'header','required':True,'schema':{'type':'string'}},{'name':'id','in':'path','required':True,'schema':ref('Id')},{'name':'part_number','in':'path','required':True,'schema':{'type':'integer','minimum':1}}];base['responses']['200']['content']['application/json']['schema']['properties']['data']={'type':'object','properties':{'part_number':{'type':'integer'},'checksum':{'type':'string'},'etag':{'type':'string'}},'required':['part_number','checksum','etag'],'additionalProperties':False};spec['paths']['/uploads/{id}/parts/{part_number}']={'put':base}
spec['paths']['/assets/{id}/confirm']={'post':copy.deepcopy(spec['paths']['/asset-versions/{id}/confirm']['post'])};spec['paths']['/assets/{id}/confirm']['post']['operationId']='post_asset_confirm_current'
base=copy.deepcopy(spec['paths']['/assets/{id}/usages']['get']);base['operationId']='get_content_revision_asset_usages';spec['paths']['/content-revisions/{id}/assets']={'get':base}
Path('contracts/openapi.json').write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
# Domain schema shares entity definitions, preserving a single validation vocabulary.
p=Path('contracts/domain.schema.json');domain=json.loads(p.read_text())
for n in ['UploadSession','Folder','AssetVersion','AssetUsage','BrandRuleSet','BrandRule']:
 if n in domain.get('$defs',{}):domain['$defs'][n]=json.loads(json.dumps(schemas[n]).replace('#/components/schemas/','#/$defs/'))
p.write_text(json.dumps(domain,ensure_ascii=False,indent=2)+'\n')

spec['components']['schemas']['RuleSetCreate']['properties']['rules']['items']['properties']['category']={'type':'string','enum':['color','identity','layout','typography','usage','other']}
base=copy.deepcopy(spec['paths']['/assets']['get']);base['operationId']='get_guideline_files';base['summary']='规范PDF原件及分页处理状态';base['parameters']=[];base['responses']['200']['content']['application/json']['schema']['properties']['data']={'type':'object','properties':{'items':{'type':'array','items':{'type':'object','properties':{'id':ref('Id'),'original_name':{'type':'string'},'preview_status':ref('PreviewStatus'),'pages':{'type':['integer','null']}},'required':['id','original_name','preview_status','pages'],'additionalProperties':False}},'next_cursor':{'type':'null'}},'required':['items','next_cursor'],'additionalProperties':False};spec['paths']['/guideline-files']={'get':base}
Path('contracts/openapi.json').write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')

base=copy.deepcopy(spec["paths"]["/files/{id}/download"]["get"]);base["operationId"]="get_guideline_file_detail";base["summary"]="规范PDF分页及可检索文本";base["responses"]["200"]["content"]["application/json"]["schema"]["properties"]["data"]=ref("FileObject");spec["paths"]["/guideline-files/{id}"]={"get":base}
Path("contracts/openapi.json").write_text(json.dumps(spec,ensure_ascii=False,indent=2)+"\n")
