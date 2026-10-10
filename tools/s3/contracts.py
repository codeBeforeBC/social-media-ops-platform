"""Extend frozen contracts with implemented collection runtime endpoints."""
import copy,json
from pathlib import Path
p=Path('contracts/openapi.json');spec=json.loads(p.read_text());schemas=spec['components']['schemas']
ref=lambda n:{'$ref':'#/components/schemas/'+n}
obj=lambda properties,required: {'type':'object','properties':properties,'required':required,'additionalProperties':False}
nullable=lambda value:{'anyOf':[value,{'type':'null'}]}
schemas['CollectionSettings']=obj({'keywords':{'type':'array','minItems':1,'maxItems':10,'items':{'type':'string','minLength':1,'maxLength':100}},'profile':{'type':'string','minLength':1,'maxLength':100},'reference_accounts':{'type':'array','maxItems':2,'uniqueItems':True,'items':{'type':'string','pattern':'^[a-fA-F0-9]{24}$'}},'max_items':{'type':'integer','minimum':1,'maximum':50}},[])
fields={'name':{'type':'string','minLength':1,'maxLength':200},'schedule':{'type':'array','maxItems':4,'uniqueItems':True,'items':{'type':'string','pattern':'^(?:[01]\\d|2[0-3]):[0-5]\\d$'}},'timezone':ref('Timezone'),'enabled':{'type':'boolean'},'min_interval_seconds':{'type':'integer','minimum':60,'maximum':86400},'config':ref('CollectionSettings')}
schemas['CollectionConnectionCreate']=obj({**fields,'platform':{'enum':['weibo','xiaohongshu']},'source_type':{'enum':['weibo_hot','xhs_topic_signal','xhs_quality_note']},'provider':{'enum':['weibo_web','opencli']}},['name','platform','source_type','provider'])
schemas['CollectionConnectionPatch']=obj({**fields,'expected_version':{'type':'integer','minimum':1}},['expected_version'])
schemas['CollectionConnection']= {'allOf':[ref('BaseEntity'),{'type':'object','properties':{**fields,'platform':{'enum':['weibo','xiaohongshu']},'source_type':{'enum':['weibo_hot','xhs_topic_signal','xhs_quality_note']},'provider':{'enum':['weibo_web','opencli']},'owner_id':ref('Id'),'health':ref('SourceHealth'),'paused':{'type':'boolean'},'consecutive_failures':{'type':'integer','minimum':0},'capabilities':ref('Capabilities'),'last_attempt_at':nullable({'type':'string','format':'date-time'}),'last_success_at':nullable({'type':'string','format':'date-time'}),'error_code':{'type':['string','null']}},'required':['name','platform','source_type','provider','enabled','paused','health','owner_id'],'additionalProperties':True}]}
schemas['CollectionRuntimeRun']={'type':'object','properties':{'id':ref('Id'),'workspace_id':ref('Id'),'connection_id':ref('Id'),'state':ref('JobStatus'),'item_count':{'type':'integer','minimum':0},'trigger':{'enum':['manual','scheduled','verify']},'error_code':{'type':['string','null']},'warnings':{'type':'array','items':{'type':'string'}},'coverage':{'type':'object'},'job_id':nullable(ref('Id')),'connection_version':{'type':'integer','minimum':1}},'required':['id','workspace_id','connection_id','state','item_count','trigger','warnings','connection_version'],'additionalProperties':True}
schemas['CollectionAccepted']=obj({'run':ref('CollectionRuntimeRun'),'reused':{'type':'boolean'}},['run','reused'])
schemas['CollectionPause']=obj({'expected_version':{'type':'integer','minimum':1},'reason':{'type':'string','minLength':1,'maxLength':1000}},['expected_version','reason'])
def envelope(data):return obj({'data':data,'meta':ref('Meta')},['data','meta'])
def response(data):return {'description':'Implemented collection runtime','content':{'application/json':{'schema':envelope(data)}}}
def listing(name,next_cursor=False):return obj({'items':{'type':'array','items':ref(name)},**({'next_cursor':{'type':['string','null']}} if next_cursor else {})},['items']+(['next_cursor'] if next_cursor else []))
for path,method,status,data,body in [('/source-connections','get','200',listing('CollectionConnection',True),None),('/source-connections','post','201',ref('CollectionConnection'),'CollectionConnectionCreate'),('/source-connections/{id}','get','200',ref('CollectionConnection'),None),('/source-connections/{id}','patch','200',ref('CollectionConnection'),'CollectionConnectionPatch'),('/source-connections/{id}/refresh','post','202',ref('CollectionAccepted'),None),('/source-connections/{id}/verify','post','202',ref('CollectionAccepted'),None),('/source-connections/{id}/runs','get','200',listing('CollectionRuntimeRun'),None),('/source-connections/{id}/pause','post','200',ref('CollectionConnection'),'CollectionPause')]:
 if path not in spec['paths']:
  op=copy.deepcopy(spec['paths']['/source-connections/{id}'][method if method=='get' else 'patch']);op['operationId']=method+'_'+path.replace('/','_').replace('{id}','id');spec['paths'][path]={method:op}
 op=spec['paths'][path][method];op['x-implementation-status']='implemented';op['responses']={k:v for k,v in op['responses'].items() if not k.startswith('2')};op['responses'][status]=response(data)
 if body:op['requestBody']={'required':True,'content':{'application/json':{'schema':ref(body)}}}
 else:op.pop('requestBody',None)
 # Lists currently return the workspace connection inventory. No ignored paging parameters are advertised.
 if method=='get':op['parameters']=[q for q in op['parameters'] if q['in']=='path']
 if method=='post':op['parameters']=[q for q in op['parameters'] if q['name']!='expected_version']
p.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')

# Implemented immutable source evidence endpoints.
schemas['CollectedEvidence']={'allOf':[ref('BaseEntity'),{'type':'object','properties':{'connection_id':ref('Id'),'external_id':{'type':'string'},'canonical_url':ref('Url'),'actual_source_type':ref('SourceType'),'title':{'type':'string'},'summary':{'type':'string'},'published_at':nullable({'type':'string','format':'date-time'}),'captured_at':{'type':'string','format':'date-time'},'date_label_raw':{'type':['string','null']},'reference_only':{'const':True},'visible_counts':{'type':'object'},'cluster_key':{'type':'string'},'availability':{'enum':['observed','unavailable','unknown']},'expired':{'type':'boolean'},'observations':{'type':'array','items':{'type':'object'}}},'required':['connection_id','external_id','canonical_url','actual_source_type','title','summary','published_at','captured_at','reference_only','visible_counts'],'additionalProperties':True}]}
for path,data in [('/source-items',listing('CollectedEvidence',True)),('/source-items/{id}',ref('CollectedEvidence'))]:
 op=spec['paths'][path]['get'];op['x-implementation-status']='implemented';op['responses']['200']=response(data);allowed=['id','cursor','limit','keyword','freshness'];op['parameters']=[q for q in op['parameters'] if q['name'] in allowed];
 if path=='/source-items':op['parameters'].append({'name':'connection_id','in':'query','required':False,'schema':ref('Id')})
p.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
