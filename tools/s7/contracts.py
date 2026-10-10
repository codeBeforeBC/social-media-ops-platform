"""S7 generated contracts, from the shared runtime metric schema and explicit HTTP DTOs."""
import json,subprocess
from pathlib import Path
p=Path('contracts/openapi.json');spec=json.loads(p.read_text());S=spec['components']['schemas']
shared=json.loads(subprocess.check_output(['pnpm','exec','tsx','tools/s7/export-schema.ts'],text=True))
ref=lambda n:{'$ref':'#/components/schemas/'+n}
obj=lambda props,required,extra=False:{'type':'object','properties':props,'required':required,'additionalProperties':extra}
string={'type':'string'};ids={'type':'array','items':ref('Id')};integer={'type':'integer','minimum':1}
S['MetricInput']=shared['metric'];S['MetricInput'].pop('$schema',None)
S['ImportCreate']=obj({'account_id':ref('Id'),'file_ids':ids,'source_type':{'enum':['csv','xlsx','manual']},'manual_rows':{'type':'array','items':{'type':'object'}},'field_mapping':{'type':'object','additionalProperties':{'enum':list(shared['fields'])}}},['account_id','file_ids','source_type'])
S['ImportRowPatch']=obj({'metric':{'type':'object'},'status':{'enum':['valid','excluded']},'reason':{'type':'string','minLength':1},'expected_version':integer},['reason','expected_version'])
S['ImportConfirm']['properties']['reason']={'type':'string','minLength':1};S['ImportConfirm']['required'].append('reason')
S['ImportBatch']=obj({'id':ref('Id'),'workspace_id':ref('Id'),'account_id':ref('Id'),'source_type':{'enum':['csv','xlsx','manual']},'status':ref('ImportStatus'),'input_file_ids':ids,'parser_version':string,'version':integer,'mapping':{'type':'object'}},['id','workspace_id','account_id','source_type','status','input_file_ids','parser_version','version','mapping'],True)
S['ImportRow']=obj({'id':ref('Id'),'batch_id':ref('Id'),'raw':{'type':'object'},'metric':{'anyOf':[ref('MetricInput'),{'type':'null'}]},'status':ref('ImportRowStatus'),'is_example':{'type':'boolean'},'corrections':{'type':'array'},'version':integer},['id','batch_id','raw','metric','status','is_example','corrections','version'],True)
for path in ['/imports','/imports/{id}','/imports/{id}/rows','/imports/template','/import-rows/{id}','/imports/{id}/confirm','/imports/{id}/revert']:
 for op in spec['paths'][path].values():op['x-implementation-status']='implemented'
S['ImportTemplate']=obj({'field_version':string,'fields':{'type':'object'},'metric_definitions':{'type':'array'},'format':{'enum':['csv','xlsx']},'filename':string,'content_base64':string,'example_policy':string},['field_version','fields','metric_definitions','format','filename','content_base64','example_policy'])
spec['paths']['/imports/template']['get']['responses']['200']['content']['application/json']['schema']['properties']['data']=ref('ImportTemplate')
p.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
# S7 metric dictionary, calculation and provenance endpoints.
def response(data):return obj({'data':data,'meta':ref('Meta')},['data','meta'])
def get(path,data):
 import copy
 op=copy.deepcopy(spec['paths']['/metrics']['get']);op['operationId']='get_'+path.strip('/').replace('/','_').replace('{','').replace('}','');op['responses']['200']['content']['application/json']['schema']=response(data);op['x-implementation-status']='implemented';
 if '{id}' in path:op['parameters']=[{'in':'path','name':'id','required':True,'schema':ref('Id')}]
 spec['paths'][path]={'get':op}
S['MetricObservation']=obj({'id':ref('Id'),'workspace_id':ref('Id'),'account_id':ref('Id'),'publication_id':{'anyOf':[ref('Id'),{'type':'null'}]},'metric':ref('MetricInput'),'value':{'type':['string','null']},'validity':{'enum':['confirmed','superseded','reverted']}},['id','workspace_id','account_id','publication_id','metric','value','validity'],True)
S['Calculation']=obj({'id':ref('Id'),'metric_key':string,'calculation_version':string,'input_observation_ids':ids,'rounding_rule':string,'window_start':{'type':'string','format':'date-time'},'window_end':{'type':'string','format':'date-time'},'value':{'type':['string','null']},'missing_reason':{'type':['string','null']},'is_approximate':{'type':'boolean'},'validity':{'enum':['current','stale']}},['id','metric_key','calculation_version','input_observation_ids','rounding_rule','window_start','window_end','value','missing_reason','is_approximate','validity'],True)
get('/metrics',obj({'items':{'type':'array','items':ref('MetricObservation')},'next_cursor':{'type':['string','null']},'definitions':{'type':'array'},'comparison_note':string},['items','next_cursor','definitions','comparison_note']))
get('/metrics/calculations',obj({'items':{'type':'array','items':ref('Calculation')},'window':{'type':'object'},'missing_reason':{'type':['string','null']},'comparison_note':string},['items','window','missing_reason','comparison_note']))
get('/metrics/{id}/sources',obj({'observation':ref('MetricObservation'),'evidence':{'type':'array'},'supersessions':{'type':'array'}},['observation','evidence','supersessions']))
get('/calculations/{id}',obj({'calculation':ref('Calculation'),'observations':{'type':'array'}},['calculation','observations']))
# Keep query parameters aligned with the actual guards rather than the generic planning superset.
for path,names in [('/imports',['account_id','limit','cursor']),('/imports/template',['format']),('/metrics',['account_id','publication_id','media_type','traffic_type','start','end','limit','cursor']),('/metrics/calculations',['account_id','publication_id','media_type','traffic_type','start','end'])]:
 spec['paths'][path]['get']['parameters']=[{'name':name,'in':'query','required':name=='account_id' or path=='/metrics/calculations' and name in ['start','end'],'schema':ref('Id') if name.endswith('_id') else {'type':'integer','minimum':1,'maximum':100} if name=='limit' else {'type':'string'}} for name in names]
p.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
