import copy,json
from pathlib import Path
p=Path('contracts/openapi.json');s=json.loads(p.read_text());schemas=s['components']['schemas']
ref=lambda n:{'$ref':'#/components/schemas/'+n}
obj=lambda props,req:{'type':'object','properties':props,'required':req,'additionalProperties':False}
def response(data):return {'description':'Content draft and generated candidate','content':{'application/json':{'schema':obj({'data':data,'meta':ref('Meta')},['data','meta'])}}}
schemas['AIRequestResult']['properties']['result_revision_id']={'anyOf':[ref('Id'),{'type':'null'}]};
if 'result_revision_id' not in schemas['AIRequestResult']['required']:schemas['AIRequestResult']['required'].append('result_revision_id')
schemas['S3Content']={'type':'object','properties':{'id':ref('Id'),'account_id':ref('Id'),'title':{'type':'string'},'media_type':ref('MediaType'),'business_status':ref('ContentStatus'),'owner_id':{'anyOf':[ref('Id'),{'type':'null'}]},'current_revision_id':{'anyOf':[ref('Id'),{'type':'null'}]},'version':{'type':'integer','minimum':1},'current_revision':{'type':['object','null']},'revisions':{'type':'array','items':{'type':'object'}},'generation_requests':{'type':'array','items':{'type':'object'}}},'required':['id','account_id','title','media_type','business_status','version'],'additionalProperties':True}
schemas['GenerateS3Brief']=copy.deepcopy(schemas['GenerateBrief']);schemas['GenerateS3Brief']['properties'].update({'target_duration_ms':{'type':'integer','minimum':1000,'maximum':600000},'aspect_ratio':{'enum':['9:16','16:9','1:1','3:4']}})
schemas['AppliedS3Brief']=obj({'content_id':ref('Id'),'revision_id':ref('Id'),'version':{'type':'integer','minimum':1},'reused':{'type':'boolean'}},['content_id','revision_id','version','reused'])
for path,method,code,data,body in [('/contents','get','200',obj({'items':{'type':'array','items':ref('S3Content')},'next_cursor':{'type':['string','null']}},['items','next_cursor']),None),('/contents/{id}','get','200',ref('S3Content'),None),('/contents/{id}/generate-brief','post','202',ref('AIAcceptedRequest'),'GenerateS3Brief'),('/contents/{id}/apply-generated','post','200',ref('AppliedS3Brief'),'ApplyGenerated')]:
 op=s['paths'][path][method];op['x-implementation-status']='implemented';op['responses']={k:v for k,v in op['responses'].items() if not k.startswith('2')};op['responses'][code]=response(data)
 if body:op['requestBody']={'required':True,'content':{'application/json':{'schema':ref(body)}}}
 if method=='get':op['parameters']=[x for x in op['parameters'] if x['in']=='path']
 if path=='/contents':op['parameters']=[{'in':'query','name':n,'required':False,'schema':schema} for n,schema in [('account_id',ref('Id')),('limit',{'type':'integer','minimum':1,'maximum':100}),('cursor',{'type':'string'})]]
p.write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n')
