"""S8 implemented analytics and review HTTP contracts."""
import json,copy
from pathlib import Path
p=Path('contracts/openapi.json');spec=json.loads(p.read_text());S=spec['components']['schemas']
ref=lambda n:{'$ref':'#/components/schemas/'+n}
obj=lambda props,required,extra=False:{'type':'object','properties':props,'required':required,'additionalProperties':extra}
string={'type':'string'}
nullable=lambda v:{'anyOf':[v,{'type':'null'}]}
time={'type':'string','format':'date-time'}
point={'observation_id':ref('Id'),'publication_id':nullable(ref('Id')),'publication_title':nullable(string),'media_type':nullable({'enum':['graphic','video']}),'value':nullable(string),'missing_reason':nullable(string),'is_approximate':{'type':'boolean'},'observed_at':nullable(time),'window_start':nullable(time),'window_end':nullable(time),'published_at':nullable(time),'age_seconds':nullable({'type':'integer'}),'analysis_warning':nullable(string)}
S['AnalysisPoint']=obj(point,list(point))
group={'metric_key':string,'unit':string,'aggregation_kind':{'enum':['snapshot','cumulative','interval']},'traffic_type':{'enum':['organic','paid','mixed','unknown']},'source_definition':string,'time_precision':{'enum':['day','minute','second']},'definition_version':string,'points':{'type':'array','items':ref('AnalysisPoint')},'trend_available':{'type':'boolean'},'comparison_note':string}
S['AnalysisGroup']=obj(group,list(group))
op=copy.deepcopy(spec['paths']['/metrics']['get']);op['operationId']='get_metrics_analysis';op['parameters']=[x for x in op['parameters'] if x['name'] not in ['limit','cursor']]
op['responses']['200']['content']['application/json']['schema']['properties']['data']=obj({'groups':{'type':'array','items':ref('AnalysisGroup')},'window':{'type':'object'},'observations_count':{'type':'integer','minimum':0},'missing_reason':{'type':['string','null']}},['groups','window','observations_count','missing_reason'])
spec['paths']['/metrics/analysis']={'get':op}
p.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
# Report/strategy business DTOs and the exact runtime AI boundary.
import subprocess
S['ReportAIOutput']=json.loads(subprocess.check_output(['pnpm','exec','tsx','tools/s8/export-schema.ts'],text=True));S['ReportAIOutput'].pop('$schema',None)
payload=S['ReportAIOutput']['properties']['task_payload']['properties']
S['ReportResult']=obj({'facts':{'type':'array','items':ref('Calculation')},'summary':string,'hypotheses':payload['hypotheses'],'actions':payload['actions'],'missing_data':{'type':'array','items':string},'warnings':{'type':'array','items':string}},['facts','summary','hypotheses','actions','missing_data','warnings'])
strategy={'id':ref('Id'),'account_id':ref('Id'),'report_id':ref('Id'),'action_index':{'type':'integer','minimum':0},'action':payload['actions']['items'],'status':{'enum':['proposed','active','retired']},'created_by':ref('Id'),'activated_by':nullable(ref('Id')),'activated_at':nullable(time),'review_at':time,'retired_reason':nullable(string),'version':{'type':'integer','minimum':1},'created_at':time,'updated_at':time}
S['StrategyMemory']=obj(strategy,list(strategy),True)
report={'id':ref('Id'),'account_id':ref('Id'),'status':{'enum':['draft','partial','final','stale']},'state':{'enum':['queued','running','succeeded','failed','cancelled']},'error_code':nullable(string),'window_start':nullable(time),'window_end':nullable(time),'version':{'type':'integer','minimum':1},'created_at':time,'updated_at':time,'snapshot':{'type':'object'},'result':nullable(ref('ReportResult')),'strategies':{'type':'array','items':ref('StrategyMemory')}}
S['Report']=obj(report,[k for k in report if k not in ['snapshot','result','strategies']],True)
create={'account_id':ref('Id'),'publication_id':ref('Id'),'media_type':{'enum':['graphic','video']},'traffic_type':{'enum':['organic','paid','mixed','unknown']},'start':time,'end':time}
S['ReportCreate']=obj(create,['account_id','start','end'])
S['ReportAcceptActions']=obj({'action_indexes':{'type':'array','items':{'type':'integer','minimum':0},'minItems':1,'maxItems':10},'reason':{'type':'string','minLength':1},'expected_version':{'type':'integer','minimum':1}},['action_indexes','reason','expected_version'])
S['ReportAccepted']=obj({'report_id':ref('Id'),'job_id':ref('Id'),'state':{'const':'queued'},'status_url':string},['report_id','job_id','state','status_url'])
def operation(path,method,data,request=None,code='200',params=None):
 template=spec['paths']['/metrics']['get'] if method=='get' else spec['paths']['/topic-generations']['post']
 op=copy.deepcopy(template);op['operationId']=method+'_'+path.strip('/').replace('/','_').replace('{','').replace('}','');op['x-implementation-status']='implemented'
 op['parameters']=[] if method=='get' else [x for x in op['parameters'] if x['in']=='header']
 if '{id}' in path:op['parameters'].insert(0,{'name':'id','in':'path','required':True,'schema':ref('Id')})
 if params:op['parameters']+=params
 for status in ['200','201','202']:op['responses'].pop(status,None)
 op['responses'][code]={'description':'成功','content':{'application/json':{'schema':obj({'data':data,'meta':ref('Meta')},['data','meta'])}}}
 if request:op['requestBody']={'required':True,'content':{'application/json':{'schema':ref(request)}}}
 else:op.pop('requestBody',None)
 spec['paths'].setdefault(path,{})[method]=op
list_params=[{'name':name,'in':'query','required':name=='account_id','schema':ref('Id') if name=='account_id' else {'type':'integer','minimum':1,'maximum':100} if name=='limit' else string} for name in ['account_id','limit','cursor']]
listing=lambda item:obj({'items':{'type':'array','items':ref(item)},'next_cursor':nullable(string)},['items','next_cursor'])
operation('/reports','get',listing('Report'),params=list_params)
operation('/reports','post',ref('ReportAccepted'),'ReportCreate','202')
operation('/reports/{id}','get',ref('Report'))
operation('/reports/{id}/accept-actions','post',ref('Report'),'ReportAcceptActions')
operation('/strategy-memories','get',listing('StrategyMemory'),params=list_params)
operation('/strategy-memories/{id}/activate','post',ref('StrategyMemory'),'ReasonVersion')
operation('/strategy-memories/{id}/retire','post',ref('StrategyMemory'),'ReasonVersion')
p.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
S['FeedbackAIOutput']=json.loads(subprocess.check_output(['pnpm','exec','tsx','tools/s8/export-schema.ts','feedback'],text=True));S['FeedbackAIOutput'].pop('$schema',None)
fp=S['FeedbackAIOutput']['properties']['task_payload']['properties']
usage=obj({'public_reply':{'type':'boolean'},'topic_reference':{'type':'boolean'}},['public_reply','topic_reference'])
feedback={'id':ref('Id'),'workspace_id':ref('Id'),'account_id':ref('Id'),'publication_id':nullable(ref('Id')),'source_url':nullable(string),'source_time':nullable(time),'text':{'type':'string','minLength':1,'maxLength':10000},'author_alias':nullable(string),'category':fp['category'],'consent_status':{'enum':['unknown','internal_only','approved','revoked']},'permitted_usage':usage,'reply_draft':fp['reply_draft'],'quotes':fp['quotes'],'topic_leads':fp['topic_leads'],'status':{'enum':['new','triaged','archived']},'created_by':ref('Id'),'job_id':nullable(ref('Id')),'ai_run_id':nullable(ref('Id')),'version':{'type':'integer','minimum':1},'created_at':time,'updated_at':time}
S['Feedback']=obj(feedback,list(feedback))
editable={k:feedback[k] for k in ['account_id','publication_id','source_url','source_time','text','author_alias','category','consent_status','permitted_usage','reply_draft','status']}
S['FeedbackCreate']=obj(editable,['account_id','text'])
S['FeedbackPatch']=obj({**{k:v for k,v in editable.items() if k!='account_id'},'reason':{'type':'string','minLength':1},'expected_version':{'type':'integer','minimum':1}},['reason','expected_version'])
S['FeedbackOrganize']=obj({'expected_version':{'type':'integer','minimum':1}},['expected_version'])
S['FeedbackAccepted']=obj({'feedback_id':ref('Id'),'job_id':ref('Id'),'state':{'enum':['queued','running']},'status_url':string},['feedback_id','job_id','state','status_url'])
operation('/feedback','get',listing('Feedback'),params=list_params+[{'name':'publication_id','in':'query','schema':ref('Id')},{'name':'status','in':'query','schema':feedback['status']}])
operation('/feedback','post',ref('Feedback'),'FeedbackCreate','201')
operation('/feedback/{id}','get',ref('Feedback'))
operation('/feedback/{id}','patch',ref('Feedback'),'FeedbackPatch')
operation('/feedback/{id}/organize','post',ref('FeedbackAccepted'),'FeedbackOrganize','202')
p.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
task=obj({'id':string,'kind':{'enum':['import_confirmation','source_health','missing_data','feedback']},'title':string,'detail':string,'updated_at':time,'href':{'type':'string','pattern':'^#(?:reports|topics)\\?'}},['id','kind','title','detail','updated_at','href'])
S['Dashboard']=obj({'stage':{'const':'S8'},'as_of':time,'accounts':{'type':'array','items':obj({'id':ref('Id'),'name':string},['id','name'])},'priority_tasks':{'type':'array','maxItems':3,'items':task},'metrics':{'type':'array','maxItems':15,'items':{'type':'object'}},'metrics_limit':{'const':15},'sources':{'type':'array','items':{'type':'object'}},'external_capabilities':{'type':'object'}},['stage','as_of','accounts','priority_tasks','metrics','metrics_limit','sources','external_capabilities'])
operation('/dashboard','get',ref('Dashboard'),params=[list_params[0]])
spec['paths']['/dashboard']['get']['parameters'][0]['required']=False
p.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
S['Monitor']=obj({'as_of':time,'jobs':{'type':'array','items':{'type':'object'}},'processes':{'type':'array','items':{'type':'object'}},'outbox_pending':{'type':'integer','minimum':0},'external_capabilities':{'type':'object'},'ai_usage':obj({'window':string,'groups':{'type':'array','items':{'type':'object'}}},['window','groups']),'import_limits':obj({'screenshot_bytes':{'type':'integer'},'table_bytes':{'type':'integer'}},['screenshot_bytes','table_bytes'])},['as_of','jobs','processes','outbox_pending','external_capabilities','ai_usage','import_limits'])
operation('/monitor','get',ref('Monitor'))
S['SettingsPatch']['properties']['category']={'enum':['workspace','capacity','ai_budget']}
p.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
S['SourceOrganizationAIOutput']=json.loads(subprocess.check_output(['pnpm','exec','tsx','tools/s8/export-schema.ts','sources'],text=True));S['SourceOrganizationAIOutput'].pop('$schema',None)
sorg={'id':ref('Id'),'account_id':ref('Id'),'state':{'enum':['queued','running','succeeded','failed','cancelled']},'error_code':nullable(string),'version':{'type':'integer','minimum':1},'reviewed_at':nullable(time),'created_at':time,'updated_at':time,'snapshot':{'type':'object'},'result':nullable(ref('SourceOrganizationAIOutput')),'current':{'type':'boolean'},'accepted_group_indexes':{'type':'array','items':{'type':'integer','minimum':0}}}
S['SourceOrganization']=obj(sorg,[k for k in sorg if k not in ['snapshot','result','current','accepted_group_indexes']],True)
S['SourceOrganizationCreate']=obj({'account_id':ref('Id'),'source_item_ids':{'type':'array','maxItems':20,'uniqueItems':True,'items':ref('Id')}},['account_id','source_item_ids'])
S['SourceOrganizationAccept']=obj({'group_indexes':{'type':'array','minItems':1,'maxItems':10,'items':{'type':'integer','minimum':0}},'reason':{'type':'string','minLength':1},'expected_version':{'type':'integer','minimum':1}},['group_indexes','reason','expected_version'])
S['SourceOrganizationAccepted']=obj({'organization_id':ref('Id'),'job_id':ref('Id'),'state':{'const':'queued'},'status_url':string},['organization_id','job_id','state','status_url'])
operation('/source-organizations','get',listing('SourceOrganization'),params=list_params)
operation('/source-organizations','post',ref('SourceOrganizationAccepted'),'SourceOrganizationCreate','202')
operation('/source-organizations/{id}','get',ref('SourceOrganization'))
operation('/source-organizations/{id}/accept','post',ref('SourceOrganization'),'SourceOrganizationAccept')
# The backend filter and permission are explicit for operational entry points.
spec['paths']['/jobs']['get']['parameters'].append({'name':'state','in':'query','schema':{'enum':['queued','running','succeeded','partial','failed','cancelled']}})
p.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
