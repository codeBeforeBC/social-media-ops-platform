import copy,json
from pathlib import Path
p=Path('contracts/openapi.json');s=json.loads(p.read_text());schemas=s['components']['schemas']
ref=lambda n:{'$ref':'#/components/schemas/'+n}
obj=lambda props,req=():{'type':'object','properties':props,'required':list(req),'additionalProperties':False}
def operation(path,method,code,data,body=None,permission='content.production'):
 if path not in s['paths']:
  s['paths'][path]={}
 op=s['paths'][path].get(method,copy.deepcopy(s['paths']['/contents/{id}/revisions']['post']))
 op['operationId']='s4_'+method+'_'+path.replace('/','_').replace('{id}','id').replace('-','_');op['x-implementation-status']='implemented';op['x-required-permission']=permission
 op['parameters']=[x for x in op.get('parameters',[]) if x.get('in')!='query']
 op['responses']={k:v for k,v in op['responses'].items() if not k.startswith('2')};op['responses'][code]={'description':'S4 production workflow','content':{'application/json':{'schema':obj({'data':data,'meta':ref('Meta')},['data','meta'])}}}
 if body:op['requestBody']={'required':True,'content':{'application/json':{'schema':ref(body)}}}
 else:op.pop('requestBody',None)
 s['paths'][path][method]=op
schemas['S4GraphicCreate']=copy.deepcopy(schemas['ContentCreate']);schemas['S4GraphicCreate']['properties']['media_type']={'const':'graphic'}
schemas['S4GraphicPage']=copy.deepcopy(schemas['GraphicPageInput']);schemas['S4GraphicPage']['required']=['position','visual_instruction','page_copy','asset_version_ids','publish_file_id'];schemas['S4GraphicPage']['properties']['asset_version_ids']['maxItems']=100
fields={'title':{'type':'string','minLength':1,'maxLength':200},'body':{'type':'string','maxLength':10000},'tags':{'type':'array','maxItems':100,'items':{'type':'string','minLength':1,'maxLength':100}},'brief':{'type':'object'},'pages':{'type':'array','maxItems':30,'items':ref('S4GraphicPage')},'base_revision_id':ref('Id'),'expected_version':ref('ExpectedVersion')}
# Existing contract uses Version directly; use the stable integer value for commands.
fields['expected_version']={'type':'integer','minimum':1}
schemas['S4GraphicRevision']=obj(fields,fields.keys())
schemas['S4Restore']=obj({'source_revision_id':ref('Id'),'base_revision_id':ref('Id'),'expected_version':fields['expected_version']},['source_revision_id','base_revision_id','expected_version'])
schemas['S4Metadata']=obj({'expected_version':fields['expected_version'],'internal_notes':{'type':'string','maxLength':10000},'planned_publish_at':{'type':['string','null'],'format':'date-time'},'estimated_hours':{'type':['number','null'],'minimum':0,'maximum':10000}},['expected_version'])
operation('/contents','post','201',ref('S3Content'),'S4GraphicCreate')
operation('/contents/{id}/revisions','post','201',ref('S3Content'),'S4GraphicRevision','content.copy')
operation('/contents/{id}/restore','post','201',ref('S3Content'),'S4Restore')
operation('/contents/{id}','patch','200',ref('S3Content'),'S4Metadata','content.copy')
filters=[('account_id',ref('Id')),('media_type',ref('MediaType')),('status',ref('ContentStatus')),('owner_id',ref('Id')),('planned_start',{'type':'string','format':'date-time'}),('planned_end',{'type':'string','format':'date-time'}),('limit',{'type':'integer','minimum':1,'maximum':100}),('cursor',{'type':'string'})]
s['paths']['/contents']['get']['parameters']=[{'in':'query','name':k,'required':False,'schema':v} for k,v in filters]
for methods in s['paths'].values():methods.pop('parameters',None)
p.write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n')
