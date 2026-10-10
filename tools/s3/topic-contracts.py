import copy,json
from pathlib import Path
p=Path('contracts/openapi.json');s=json.loads(p.read_text());schemas=s['components']['schemas']
ref=lambda n:{'$ref':'#/components/schemas/'+n}
obj=lambda props,req:{'type':'object','properties':props,'required':req,'additionalProperties':False}
def response(data):return {'description':'Persisted topic lifecycle','content':{'application/json':{'schema':obj({'data':data,'meta':ref('Meta')},['data','meta'])}}}
schemas['PersistedTopic']={'type':'object','properties':{'id':ref('Id'),'account_id':ref('Id'),'candidate':ref('TopicCandidate'),'score':{'type':['string','number']},'status':ref('TopicStatus'),'version':{'type':'integer','minimum':1},'missing_inputs':{'type':'array','items':{'type':'string'}},'warnings':{'type':'array','items':{'type':'string'}},'parent_topic_id':{'anyOf':[ref('Id'),{'type':'null'}]}},'required':['id','account_id','candidate','score','status','version','missing_inputs','warnings','parent_topic_id'],'additionalProperties':True}
schemas['AcceptPersistedTopic']=copy.deepcopy(schemas['AcceptTopic']);schemas['AcceptPersistedTopic']['required']=['expected_version']
for path,method,code,data,body in [('/topics','get','200',obj({'items':{'type':'array','items':ref('PersistedTopic')},'next_cursor':{'type':['string','null']}},['items','next_cursor']),None),('/topics/{id}','get','200',ref('PersistedTopic'),None),('/topics/{id}/accept','post','200',ref('TopicAccepted'),'AcceptPersistedTopic'),('/topics/{id}/reject','post','200',ref('PersistedTopic'),'ReasonVersion'),('/topics/{id}/variants','post','201',ref('PersistedTopic'),'TopicVariant')]:
 if path not in s['paths']:s['paths'][path]={method:copy.deepcopy(s['paths']['/source-items/{id}']['get'])}
 op=s['paths'][path][method];op['operationId']=method+'_'+path.replace('/','_').replace('{id}','id');op['x-implementation-status']='implemented';op['responses']={k:v for k,v in op['responses'].items() if not k.startswith('2')};op['responses'][code]=response(data)
 if body:op['requestBody']={'required':True,'content':{'application/json':{'schema':ref(body)}}}
 if method=='get':op['parameters']=[x for x in op['parameters'] if x['in']=='path']
 if path=='/topics':op['parameters']=[{'in':'query','name':n,'required':False,'schema':schema} for n,schema in [('account_id',ref('Id')),('status',ref('TopicStatus')),('media_type',ref('MediaType')),('freshness',{'enum':['all','fresh','expired']}),('limit',{'type':'integer','minimum':1,'maximum':100}),('cursor',{'type':'string'})]]
p.write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n')
