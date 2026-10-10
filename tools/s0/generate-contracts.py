from pathlib import Path
import json,re,copy
root=Path(__file__).resolve().parents[2]
S={}
def obj(props,required=(),strict=True):return {'type':'object','properties':props,'required':list(required),'additionalProperties':not strict}
def ref(name):return {'$ref':'#/components/schemas/'+name}
def arr(item):return {'type':'array','items':item}
def enum(*values):return {'type':'string','enum':list(values)}
string={'type':'string','maxLength':10000}; title={'type':'string','minLength':1,'maxLength':200}; version={'type':'integer','minimum':1}; integer={'type':'integer','minimum':0}; timestamp={'type':'string','format':'date-time'}; boolean={'type':'boolean'}
def nullable(s):return {'anyOf':[s,{'type':'null'}]}
S['Id']={'type':'string','format':'uuid'}
S['Decimal']={'type':'string','pattern':r'^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$','description':'精确十进制使用字符串传输，禁止NaN/Infinity；计数非负/净增可负由指标字典校验。'}
S['Timezone']={'type':'string','minLength':1,'description':'服务端必须以IANA时区数据库校验，默认Asia/Shanghai。'}
S['Url']={'type':'string','format':'uri','maxLength':4096,'description':'业务服务校验来源允许域、HTTPS、重定向及目标IP；Schema不是SSRF防护。'}
ids=arr(ref('Id'))
for name,values in {
'Role':['admin','editor','operator','viewer'],'MediaType':['graphic','video'],'TopicStatus':['proposed','accepted','rejected','expired'],'FileStatus':['uploading','ready','failed','quarantined'],'PreviewStatus':['not_requested','processing','ready','unsupported','failed'],'JobStatus':['queued','running','succeeded','partial','failed','cancelled'],'SourceHealth':['unverified','healthy','degraded','auth_required','rate_limited','unavailable','disabled'],'SourceType':['official_rank','topic','search','curated_feed','account_feed'],'ImportStatus':['uploaded','parsing','needs_confirmation','committing','confirmed','partially_confirmed','failed','reverted'],'ImportRowStatus':['valid','conflict','unmatched','excluded','confirmed'],'TrafficType':['organic','paid','mixed','unknown'],'ReportStatus':['draft','partial','final','stale'],'ConsentStatus':['unknown','internal_only','approved','revoked'],}.items():S[name]=enum(*values)
S['BaseEntity']=obj({'id':ref('Id'),'workspace_id':ref('Id'),'created_at':timestamp,'updated_at':timestamp,'created_by':ref('Id'),'version':version},['id','workspace_id','version'],False)
S['Meta']=obj({'request_id':title,'server_time':timestamp},['request_id','server_time'])
S['ErrorEnvelope']=obj({'error':obj({'code':title,'message':string,'field_errors':arr(obj({'field':title,'message':string},['field','message'])),'retryable':boolean,'request_id':title,'latest_version':version},['code','message','retryable','request_id'])},['error'])
S['AcceptedJob']=obj({'job_id':ref('Id'),'status_url':ref('Url'),'input_version':version,'import_batch_id':ref('Id')},['job_id','status_url'])
S['Capabilities']=obj({key:nullable(boolean) for key in ['list_items','read_detail','read_comments','historical_metrics','own_account_metrics']})
S['Evidence']=obj({'source_item_id':nullable(ref('Id')),'claim':string,'evidence_kind':enum('fact','inference','original_hypothesis')},['claim','evidence_kind'])
S['TopicCandidate']=obj({'title':title,'audience':string,'need':string,'scene':string,'column':title,'emotion':title,'media_type':ref('MediaType'),'follow_reason':string,'evidence_refs':arr(ref('Evidence')),'original_angle':string,'score_breakdown':arr(obj({'criterion':title,'score':{'type':'number','minimum':0,'maximum':5},'reason':string},['criterion','score','reason'])),'estimated_hours':nullable({'type':'number','minimum':0}),'expires_at':nullable(timestamp),'assumptions':arr(string)},['title','audience','need','media_type','follow_reason','evidence_refs','original_angle','assumptions'])
S['MetricInput']=obj({'target':obj({'account_id':ref('Id'),'publication_id':nullable(ref('Id'))},['account_id']),'metric_key':title,'definition_version':version,'aggregation_kind':enum('snapshot','cumulative','interval','rate','duration'),'value':nullable(ref('Decimal')),'unit':title,'missing_reason':nullable(string),'window_start':nullable(timestamp),'window_end':nullable(timestamp),'observed_at':nullable(timestamp),'traffic_type':ref('TrafficType'),'is_approximate':boolean,'source_definition':string},['target','metric_key','definition_version','aggregation_kind','value','unit','traffic_type','is_approximate'])
S['MetricInput']['allOf']=[{'if':{'properties':{'value':{'type':'null'}}},'then':{'required':['missing_reason'],'properties':{'missing_reason':{'type':'string','minLength':1}}}},{'if':{'properties':{'aggregation_kind':{'enum':['snapshot','cumulative']}}},'then':{'required':['observed_at'],'properties':{'observed_at':timestamp}}},{'if':{'properties':{'aggregation_kind':{'const':'interval'}}},'then':{'required':['window_start','window_end'],'properties':{'window_start':timestamp,'window_end':timestamp}}}]
S['ReportPayload']=obj({'facts':arr(obj({'claim':string,'calculation_id':ref('Id'),'observation_ids':ids},['claim','calculation_id','observation_ids'])),'hypotheses':arr(obj({'reason':string,'supporting_refs':ids,'alternative_explanations':arr(string)},['reason','supporting_refs','alternative_explanations'])),'actions':{'type':'array','maxItems':3,'items':obj({'change':string,'owner_role':ref('Role'),'effort':string,'success_metric':title,'observation_window':string},['change','owner_role','effort','success_metric','observation_window'])},'missing_data':arr(string),'confidence_notes':arr(string)},['facts','hypotheses','actions','missing_data'])
# Resolve all entity names/fields from the logical model; refined properties override string fallbacks.
model=(root/'docs/yoyo-workbench-v1.0/05-数据模型与字典.md').read_text()
entities={}
for line in model.splitlines():
 if not line.startswith('| '):continue
 cols=[x.strip() for x in line.split('|')[1:-1]]
 if len(cols)!=2 or not re.match(r'^[A-Z][A-Za-z /]+$',cols[0]):continue
 for name in cols[0].split(' / '):
  props={}
  for token in re.findall(r'\b[a-z][a-z_0-9]+\??',cols[1]):
   field=token.rstrip('?')
   if field in {'id','workspace_id','version'}:continue
   typ=ref('Id') if field.endswith('_id') else timestamp if field.endswith('_at') else boolean if field.startswith('is_') else integer if field in {'position','version_no','revision_no','size_bytes','start_ms','end_ms','item_count','attempts','attempt_no','winner_count'} else string
   if token.endswith('?'):typ=nullable(typ)
   props[field]=typ
  entities[name]={'allOf':[ref('BaseEntity'),obj(props,(),False)]}
S.update(entities)
for name in ['Job','Notification','AuditLog','StrategyMemory']:
 S.setdefault(name,{'allOf':[ref('BaseEntity'),obj({},(),False)]})
for entity in entities.values():
 for field in list(entity['allOf'][1]['properties']):
  if field.endswith('_ids') or field in {'input_refs','result_refs','evidence_refs','evidence_file_ids'}:entity['allOf'][1]['properties'][field]=ids
  elif field in {'tags','assumptions','constraints','deliverables'}:entity['allOf'][1]['properties'][field]=arr(string)
  elif field in {'settings','metadata','metrics','score_breakdown','dependencies','user_corrections','coverage','cost','validation','usage','payload','partial_fields','allowed_config'}:entity['allOf'][1]['properties'][field]={'type':'object'}

for name,props in {
 'Membership':{'roles':arr(ref('Role')),'active':boolean},
 'FileObject':{'file_status':ref('FileStatus'),'preview_status':ref('PreviewStatus')},
 'Topic':{'status':ref('TopicStatus'),'candidate':ref('TopicCandidate')},
 'SourceConnection':{'health':ref('SourceHealth'),'capabilities':ref('Capabilities'),'source_type':ref('SourceType')},
 'Job':{'state':ref('JobStatus')},'CollectionRun':{'state':ref('JobStatus')},
 'ImportBatch':{'status':ref('ImportStatus')},'ImportRow':{'status':ref('ImportRowStatus')},
 'Publication':{'traffic_type':ref('TrafficType'),'lifecycle':enum('active','deleted'),'media_type':ref('MediaType')},
 'Feedback':{'consent_status':ref('ConsentStatus')},'Report':{'status':ref('ReportStatus'),'payload':ref('ReportPayload')}
}.items():S[name]['allOf'][1]['properties'].update(props)
def req(name,props,required=()):S[name]=obj(props,required);return name
reason={'reason':{'type':'string','minLength':1,'maxLength':10000},'expected_version':version}
req('ReasonVersion',reason,['reason','expected_version']);req('ExpectedVersion',{'expected_version':version},['expected_version'])
req('Login',{'email':{'type':'string','format':'email'},'password':{'type':'string','minLength':1,'maxLength':1024}},['email','password'])
req('AccountPatch',{'name':title,'owner_id':ref('Id'),'timezone':ref('Timezone'),'expected_version':version},['expected_version'])
req('SettingsPatch',{'category':title,'settings':{'type':'object'},'expected_version':version},['category','settings','expected_version'])
req('MemberCreate',{'email':{'type':'string','format':'email'},'display_name':title,'roles':arr(ref('Role'))},['email','roles'])
req('MemberPatch',{'roles':arr(ref('Role')),'active':boolean,'successor_id':ref('Id'),'expected_version':version},['expected_version'])
req('SourceCreate',{'platform':enum('weibo','xiaohongshu'),'provider':title,'source_type':ref('SourceType'),'capabilities':ref('Capabilities'),'credential_ref':nullable(title),'schedule':title},['platform','provider','source_type','capabilities','schedule'])
req('SourcePatch',{'allowed_config':{'type':'object'},'enabled':boolean,'expected_version':version},['expected_version'])
req('RefreshSource',{'bounded_scope':obj({'keywords':arr(title),'account_ids':arr(title),'limit':{'type':'integer','minimum':1,'maximum':50}},(),True)})
req('TopicGeneration',{'account_id':ref('Id'),'window':obj({'start':timestamp,'end':timestamp},['start','end']),'columns':arr(title),'capacity_hours':nullable({'type':'number','minimum':0})},['account_id','window','columns'])
req('AcceptTopic',{'owner_id':ref('Id'),'expected_version':version},['expected_version'])
req('TopicVariant',{'goal':string,'media_type':ref('MediaType')},['goal','media_type'])
req('PublicationCreate',{'account_id':ref('Id'),'platform_note_id':title,'url':ref('Url'),'title':title,'media_type':ref('MediaType'),'published_at':timestamp,'traffic_type':ref('TrafficType')},['account_id','platform_note_id','url','title','media_type','published_at','traffic_type'])
req('PublicationPatch',{'title':title,'published_at':timestamp,'traffic_type':ref('TrafficType'),'lifecycle':enum('active','deleted'),**reason},['reason','expected_version'])
feedback={'publication_id':nullable(ref('Id')),'source_url':nullable(ref('Url')),'text':string,'source_time':nullable(timestamp),'category':title,'author_alias':nullable(title),'consent_status':ref('ConsentStatus'),'permitted_usage':string,'reply_draft':nullable(string),'status':enum('new','triaged','archived')}
req('FeedbackCreate',feedback,['text','consent_status','permitted_usage']);req('FeedbackPatch',{**feedback,'expected_version':version},['expected_version'])
req('UploadCreate',{'name':title,'size_bytes':{'type':'integer','minimum':1,'maximum':52428800},'mime_hint':title,'sha256':{'type':'string','pattern':'^[a-f0-9]{64}$'},'purpose':enum('import_screenshot','import_table','source_evidence'),'account_id':ref('Id')},['name','size_bytes','mime_hint','purpose','account_id'])
req('UploadPart',{'part_number':{'type':'integer','minimum':1},'checksum':title},['part_number','checksum'])
req('UploadComplete',{'parts_manifest':{'type':'array','minItems':1,'items':obj({'part_number':{'type':'integer','minimum':1},'etag':title,'checksum':title},['part_number','etag','checksum'])}},['parts_manifest'])
req('UploadAbort',{'reason':string})
req('ImportCreate',{'account_id':ref('Id'),'file_ids':ids,'source_type':enum('screenshot','csv','xlsx','manual'),'hint':string,'manual_rows':arr(ref('MetricInput'))},['account_id','file_ids','source_type'])
S['ImportCreate']['allOf']=[{'if':{'properties':{'source_type':{'const':'manual'}}},'then':{'required':['manual_rows'],'properties':{'manual_rows':{'minItems':1}}},'else':{'properties':{'file_ids':{'minItems':1}}}}]
req('ImportRowPatch',{'metric':ref('MetricInput'),'status':enum('valid','excluded'),'expected_version':version},['expected_version'])
req('ImportConfirm',{'row_ids':{'type':'array','items':ref('Id'),'minItems':1,'uniqueItems':True},'conflict_resolutions':arr(obj({'row_id':ref('Id'),'resolution':enum('keep_existing','replace'),'existing_observation_id':ref('Id')},['row_id','resolution','existing_observation_id'])),'expected_version':version},['row_ids','conflict_resolutions','expected_version'])
req('ReportCreate',{'account_id':ref('Id'),'period':obj({'start':timestamp,'end':timestamp},['start','end']),'filters':obj({'media_type':ref('MediaType'),'traffic_type':ref('TrafficType')})},['account_id','period'])
req('ReportAcceptActions',{'action_ids':ids,'expected_version':version},['action_ids','expected_version'])
# Derive and expand the documented routes, preserving source descriptions.
paths={}
def add(method,path,description):
 path=path.replace('或resume或cancel','')
 op={'operationId':method.lower()+'_'+re.sub(r'[^a-z0-9]+','_',path.lower()).strip('_'),'summary':description.split('；')[0][:120],'description':description,'security':[{'sessionCookie':[]}],'parameters':[],'responses':{}}
 for param in re.findall(r'{([^}]+)}',path):op['parameters'].append({'name':param,'in':'path','required':True,'schema':ref('Id')})
 if method=='GET':
  for name,schema in {'workspace_id':ref('Id'),'account_id':ref('Id'),'cursor':string,'limit':{'type':'integer','minimum':1,'maximum':100,'default':20},'start':timestamp,'end':timestamp,'sort':title,'status':title,'owner_id':ref('Id'),'media_type':ref('MediaType'),'traffic_type':ref('TrafficType'),'kind':title,'revision_id':ref('Id'),'purpose':enum('import_screenshot','import_table','source_evidence'),'account_id':ref('Id'),'unread':boolean,'problem_only':boolean,'keys':arr(title),'publication_id':ref('Id'),'source_type':ref('SourceType'),'freshness':title,'keyword':title,'date':{'type':'string','format':'date'},'timezone':ref('Timezone'),'captured_after':timestamp}.items():op['parameters'].append({'name':name,'in':'query','required':False,'schema':schema})
 else:
  op['parameters'].append({'name':'Idempotency-Key','in':'header','required':True,'schema':{'type':'string','minLength':1,'maxLength':200}})
  op['parameters'].append({'name':'X-CSRF-Token','in':'header','required':True,'schema':title})
 paths.setdefault(path,{})[method.lower()]=op
routes={
 'accounts':('SocialAccount','AccountCreate','AccountPatch'),'source-connections':('SourceConnection','SourceCreate','SourcePatch'),
 'members':('Membership','MemberCreate','MemberPatch'),'topics':('Topic',None,None),
 'publications':('Publication','PublicationCreate','PublicationPatch'),'feedback':('Feedback','FeedbackCreate','FeedbackPatch'),
 'imports':('ImportBatch','ImportCreate',None),'reports':('Report','ReportCreate',None),
 'jobs':('Job',None,None),'source-items':('SourceItem',None,None),'notifications':('Notification',None,None),
 'audit-logs':('AuditLog',None,None),'uploads':('UploadSession','UploadCreate',None)
}
def operation(method,path,data,request=None,code='200',implemented=False):
 add(method.upper(),path,'内部运营工作台接口')
 op=paths[path][method]
 if request:op['requestBody']={'required':True,'content':{'application/json':{'schema':ref(request)}}}
 op['responses'][code]={'description':'成功','content':{'application/json':{'schema':obj({'data':data,'meta':ref('Meta')},['data','meta'])}}}
 for error in ['401','403','404','409','422','429','503','500']:op['responses'][error]={'description':'错误','content':{'application/json':{'schema':ref('ErrorEnvelope')}}}
 op['x-implementation-status']='implemented' if implemented else 'planned'
for name,(entity,create,patch) in routes.items():
 operation('get','/'+name,obj({'items':arr(ref(entity)),'next_cursor':nullable(string)},['items','next_cursor']))
 if name!='audit-logs':operation('get','/'+name+'/{id}',ref(entity))
 if create:operation('post','/'+name,ref(entity),create,'202' if name in ['imports','reports'] else '201')
 if patch:operation('patch','/'+name+'/{id}',ref(entity),patch)
S['Csrf']=obj({'csrf_token':title},['csrf_token'])
S['Download']=obj({'url':ref('Url'),'expires_at':timestamp,'file_id':ref('Id')},['url','expires_at','file_id'])
S['TopicAccepted']=obj({'decision_id':ref('Id'),'topic_id':ref('Id'),'status':{'const':'accepted'},'version':version},['decision_id','topic_id','status','version'])
for method,path,data,request,code in [
 ('post','/topic-generations',ref('AcceptedJob'),'TopicGeneration','202'),
 ('post','/topics/{id}/accept',ref('TopicAccepted'),'AcceptTopic','200'),
 ('post','/topics/{id}/reject',ref('Topic'),'ReasonVersion','200'),('post','/topics/{id}/variants',ref('Topic'),'TopicVariant','201'),
 ('get','/settings',ref('Workspace'),None,'200'),('patch','/settings',ref('Workspace'),'SettingsPatch','200'),
 ('get','/me',ref('Membership'),None,'200'),('get','/dashboard',obj({},[],False),None,'200'),
 ('get','/monitor',obj({},[],False),None,'200'),('post','/notifications/{id}/read',ref('Notification'),None,'200'),
 ('get','/files/{id}/download',ref('Download'),None,'200'),('get','/files/{id}/preview',ref('Download'),None,'200'),
 ('post','/uploads/{id}/parts',obj({},[],False),'UploadPart','200'),('put','/uploads/{id}/parts/{part_number}',obj({},[],False),None,'200'),
 ('post','/uploads/{id}/complete',ref('FileObject'),'UploadComplete','200'),('post','/uploads/{id}/abort',ref('UploadSession'),'UploadAbort','200'),
 ('get','/imports/{id}/rows',obj({'items':arr(ref('ImportRow')),'next_cursor':nullable(string)},['items','next_cursor']),None,'200'),
 ('get','/imports/template',obj({},[],False),None,'200'),('patch','/import-rows/{id}',ref('ImportRow'),'ImportRowPatch','200'),
 ('post','/imports/{id}/confirm',ref('ImportBatch'),'ImportConfirm','200'),('post','/imports/{id}/revert',ref('ImportBatch'),'ReasonVersion','200'),
 ('get','/metrics',obj({},[],False),None,'200'),('post','/reports/{id}/accept-actions',ref('Report'),'ReportAcceptActions','200'),
 ('post','/strategy-memories/{id}/activate',ref('StrategyMemory'),'ReasonVersion','200')
]:operation(method,path,data,request,code)
# S1运行契约扩展从独立模块维护，S0原始证据不覆盖。
exec((root/'tools/s1/contract-extension.py').read_text())
spec={'openapi':'3.1.0','info':{'title':'YOYO 内部运营工作台','version':'1.2.0','description':'内部契约；S1实现的端点标记implemented，其余planned。不是平台外部API。业务守卫见ADR-002/003。'},'servers':[{'url':'http://localhost:3000/api/v1','description':'本地Compose默认入口'}],'paths':paths,'components':{'securitySchemes':{'sessionCookie':{'type':'apiKey','in':'cookie','name':'yoyo_session'}},'schemas':S}}
(root/'contracts/openapi.json').write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
text=json.dumps({'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'urn:yoyo:domain:v1','$defs':S},ensure_ascii=False,indent=2).replace('#/components/schemas/','#/$defs/')
(root/'contracts/domain.schema.json').write_text(text+'\n')
import subprocess
for extension in ['tools/s3/contracts.py','tools/s3/ai-contracts.py','tools/s3/topic-contracts.py','tools/s11/contracts.py','tools/s7/contracts.py']:
 subprocess.run(['python3',extension],check=True)
spec=json.loads((root/'contracts/openapi.json').read_text())
(root/'contracts/domain.schema.json').write_text(json.dumps({'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'urn:yoyo:domain:v1.2','$defs':spec['components']['schemas']},ensure_ascii=False,indent=2).replace('#/components/schemas/','#/$defs/')+'\n')
manifest={'paths':len(spec['paths']),'operations':sum(len(v) for v in spec['paths'].values()),'schemas':len(spec['components']['schemas']),'version':'1.2.0'}
(root/'docs/evidence/s7/contract-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest))
