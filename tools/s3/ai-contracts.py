import copy,json,subprocess
from pathlib import Path
p=Path('contracts/openapi.json');s=json.loads(p.read_text());schemas=s['components']['schemas']
ref=lambda n:{'$ref':'#/components/schemas/'+n}
# Generate the wire model from the same Zod boundary used by the gateway.
schemas.update(json.loads(subprocess.check_output(['pnpm','exec','tsx','tools/s11/export-ai-schema.ts'],text=True)))
obj=lambda props,req:{'type':'object','properties':props,'required':req,'additionalProperties':False}
def response(data):return {'description':'AI persisted request','content':{'application/json':{'schema':obj({'data':data,'meta':ref('Meta')},['data','meta'])}}}
schemas['AIAcceptedRequest']=obj({'request_id':ref('Id'),'state':{'const':'queued'},'status_url':{'type':'string'}},['request_id','state','status_url'])
schemas['AIRequestResult']=obj({'id':ref('Id'),'account_id':ref('Id'),'kind':{'enum':['topics']},'state':{'enum':['queued','running','succeeded','failed','cancelled']},'input_version':{'type':'string'},'job_id':{'anyOf':[ref('Id'),{'type':'null'}]},'ai_run_id':{'anyOf':[ref('Id'),{'type':'null'}]},'result':{'anyOf':[ref('AITopicOutput'),{'type':'null'}]},'error_code':{'type':['string','null']},'created_at':{'type':'string','format':'date-time'},'finished_at':{'type':['string','null'],'format':'date-time'}},['id','account_id','kind','state','input_version','job_id','ai_run_id','result','error_code','created_at','finished_at'])
op=s['paths']['/topic-generations']['post'];op['x-implementation-status']='implemented';op['responses']['202']=response(ref('AIAcceptedRequest'))
new=copy.deepcopy(s['paths']['/source-items/{id}']['get']);new['operationId']='get_ai_requests_id';new['summary']='Get persisted AI request';new['responses']['200']=response(ref('AIRequestResult'));s['paths']['/ai-requests/{id}']={'get':new}
p.write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n')
