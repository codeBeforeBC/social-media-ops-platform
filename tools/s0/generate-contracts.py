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
'Role':['admin','editor','reviewer','operator','viewer'],'MediaType':['graphic','video'],'ContentStatus':['draft','in_production','in_review','ready_to_publish','published','cancelled'],'ReviewStatus':['pending','approved','rejected','withdrawn','stale'],'TopicStatus':['proposed','accepted','rejected','expired'],'AssetStatus':['pending_confirmation','usable','retired'],'FileStatus':['uploading','ready','failed','quarantined'],'PreviewStatus':['not_requested','processing','ready','unsupported','failed'],'CampaignStatus':['draft','scheduled','drawn','announced','paused','cancelled'],'JobStatus':['queued','running','succeeded','partial','failed','cancelled'],'SourceHealth':['unverified','healthy','degraded','auth_required','rate_limited','unavailable','disabled'],'SourceType':['official_rank','topic','search','curated_feed','account_feed'],'ImportStatus':['uploaded','parsing','needs_confirmation','committing','confirmed','partially_confirmed','failed','reverted'],'ImportRowStatus':['valid','conflict','unmatched','excluded','confirmed'],'TrafficType':['organic','paid','mixed','unknown'],'ReportStatus':['draft','partial','final','stale'],'ConsentStatus':['unknown','internal_only','approved','revoked'],'AssetCategory':['guideline','2d','3d_source','render','video','audio'],'EventKind':['production','review','planned_publish','metric_check','draw']}.items():S[name]=enum(*values)
S['BaseEntity']=obj({'id':ref('Id'),'workspace_id':ref('Id'),'created_at':timestamp,'updated_at':timestamp,'created_by':ref('Id'),'version':version},['id','workspace_id','version'],False)
S['Meta']=obj({'request_id':title,'server_time':timestamp},['request_id','server_time'])
S['ErrorEnvelope']=obj({'error':obj({'code':title,'message':string,'field_errors':arr(obj({'field':title,'message':string},['field','message'])),'retryable':boolean,'request_id':title,'latest_version':version},['code','message','retryable','request_id'])},['error'])
S['AcceptedJob']=obj({'job_id':ref('Id'),'status_url':ref('Url'),'input_version':version,'import_batch_id':ref('Id')},['job_id','status_url'])
S['Capabilities']=obj({key:nullable(boolean) for key in ['list_items','read_detail','read_comments','historical_metrics','own_account_metrics']})
S['Evidence']=obj({'source_item_id':nullable(ref('Id')),'claim':string,'evidence_kind':enum('fact','inference','original_hypothesis')},['claim','evidence_kind'])
S['TopicCandidate']=obj({'title':title,'audience':string,'need':string,'scene':string,'column':title,'emotion':title,'media_type':ref('MediaType'),'follow_reason':string,'evidence_refs':arr(ref('Evidence')),'original_angle':string,'score_breakdown':arr(obj({'criterion':title,'score':{'type':'number','minimum':0,'maximum':5},'reason':string},['criterion','score','reason'])),'required_asset_ids':ids,'estimated_hours':nullable({'type':'number','minimum':0}),'expires_at':nullable(timestamp),'assumptions':arr(string)},['title','audience','need','media_type','follow_reason','evidence_refs','original_angle','assumptions'])
S['AssetUsageInput']=obj({'asset_version_id':ref('Id'),'usage_role':title,'clip_start_ms':integer,'clip_end_ms':integer},['asset_version_id','usage_role'])
S['GraphicPageInput']=obj({'position':{'type':'integer','minimum':1},'visual_instruction':string,'page_copy':string,'asset_version_ids':ids,'publish_file_id':nullable(ref('Id'))},['position','visual_instruction','page_copy'])
S['VideoShotInput']=obj({'position':{'type':'integer','minimum':1},'start_ms':integer,'end_ms':{'type':'integer','minimum':1},'action':string,'subtitle':string,'voiceover':nullable(string),'sound':string,'asset_refs':arr(ref('AssetUsageInput'))},['position','start_ms','end_ms','action'])
S['DeliverableInput']=obj({'role':enum('publish_image','final_video','cover','subtitle','editable_source'),'file_id':ref('Id'),'order':integer,'metadata':{'type':'object'}},['role','file_id'])
S['Brief']=obj({'goal':string,'audience':string,'follow_reason':string,'emotion':string,'deliverables':arr(string),'constraints':arr(string),'required_assets':ids,'estimated_hours':nullable({'type':'number','minimum':0}),'target_duration_ms':{'type':'integer','minimum':1},'aspect_ratio':title},['goal','audience','follow_reason'],False)
S['ContentRevisionInput']=obj({'base_revision_id':ref('Id'),'expected_version':version,'title':title,'body':string,'tags':arr(title),'brief':ref('Brief'),'media_type':ref('MediaType'),'pages':arr(ref('GraphicPageInput')),'shots':arr(ref('VideoShotInput')),'deliverables':arr(ref('DeliverableInput')),'asset_usages':arr(ref('AssetUsageInput'))},['base_revision_id','expected_version','title','body','media_type'])
S['ContentRevisionInput']['allOf']=[{'if':{'properties':{'media_type':{'const':'graphic'}}},'then':{'required':['pages'],'not':{'required':['shots']}}},{'if':{'properties':{'media_type':{'const':'video'}}},'then':{'required':['shots'],'not':{'required':['pages']}}}]
S['ReminderRuleInput']=obj({'id':ref('Id'),'offset_seconds':{'type':'integer','maximum':0},'enabled':boolean,'channel':{'const':'in_app'},'recipient_ids':{'type':'array','items':ref('Id'),'minItems':1,'uniqueItems':True}},['offset_seconds','enabled','channel','recipient_ids'])
S['CampaignCreate']=obj({'content_id':ref('Id'),'publication_id':nullable(ref('Id')),'name':title,'rules_revision':ref('Id'),'participation_end_at':timestamp,'draw_at':timestamp,'timezone':ref('Timezone'),'owner_id':ref('Id'),'reminders':arr(ref('ReminderRuleInput')),'prize_summary':string,'winner_count':{'type':'integer','minimum':1},'participation_method':string,'history_reason':string},['content_id','name','rules_revision','participation_end_at','draw_at','timezone','owner_id','reminders'])
S['CampaignPatch']=copy.deepcopy(S['CampaignCreate']);S['CampaignPatch']['properties']['expected_version']=version;S['CampaignPatch']['required']=['expected_version']
S['MetricInput']=obj({'target':obj({'account_id':ref('Id'),'publication_id':nullable(ref('Id'))},['account_id']),'metric_key':title,'definition_version':version,'aggregation_kind':enum('snapshot','cumulative','interval','rate','duration'),'value':nullable(ref('Decimal')),'unit':title,'missing_reason':nullable(string),'window_start':nullable(timestamp),'window_end':nullable(timestamp),'observed_at':nullable(timestamp),'traffic_type':ref('TrafficType'),'is_approximate':boolean,'source_definition':string},['target','metric_key','definition_version','aggregation_kind','value','unit','traffic_type','is_approximate'])
S['MetricInput']['allOf']=[{'if':{'properties':{'value':{'type':'null'}}},'then':{'required':['missing_reason'],'properties':{'missing_reason':{'type':'string','minLength':1}}}},{'if':{'properties':{'aggregation_kind':{'enum':['snapshot','cumulative']}}},'then':{'required':['observed_at'],'properties':{'observed_at':timestamp}}},{'if':{'properties':{'aggregation_kind':{'const':'interval'}}},'then':{'required':['window_start','window_end'],'properties':{'window_start':timestamp,'window_end':timestamp}}}]
S['ReportPayload']=obj({'facts':arr(obj({'claim':string,'calculation_id':ref('Id'),'observation_ids':ids},['claim','calculation_id','observation_ids'])),'hypotheses':arr(obj({'reason':string,'supporting_refs':ids,'alternative_explanations':arr(string)},['reason','supporting_refs','alternative_explanations'])),'actions':{'type':'array','maxItems':3,'items':obj({'change':string,'owner_role':ref('Role'),'effort':string,'success_metric':title,'observation_window':string},['change','owner_role','effort','success_metric','observation_window'])},'missing_data':arr(string),'confidence_notes':arr(string)},['facts','hypotheses','actions','missing_data'])
# Resolve all entity names/fields from the logical model; refined properties override string fallbacks.
model=(root/'docs/yoyo-workbench-v1.0/05-数据模型与字典.md').read_text()
entities={}
for line in model.splitlines():
 if not line.startswith('| '):continue
 cols=[x.strip() for x in line.split('|')[1:-1]]
 if len(cols)!=3 or not re.match(r'^[A-Z][A-Za-z /]+$',cols[0]):continue
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
for entity in entities.values():
 for field in list(entity['allOf'][1]['properties']):
  if field.endswith('_ids') or field in {'required_assets','input_refs','result_refs','evidence_refs','evidence_file_ids'}:entity['allOf'][1]['properties'][field]=ids
  elif field in {'tags','assumptions','constraints','deliverables'}:entity['allOf'][1]['properties'][field]=arr(string)
  elif field in {'settings','metadata','metrics','brief','checklist','score_breakdown','dependencies','user_corrections','coverage','cost','validation','usage','payload','partial_fields','allowed_config'}:entity['allOf'][1]['properties'][field]={'type':'object'}

refinements={
'Content':{'status':ref('ContentStatus'),'media_type':ref('MediaType'),'supersedes_content_id':nullable(ref('Id'))},
'Campaign':{'status':ref('CampaignStatus'),'campaign_version':version,'reminders':arr(ref('ReminderRuleInput'))},
'Membership':{'roles':arr(ref('Role')),'active':boolean},
'Asset':{'business_status':ref('AssetStatus'),'category':ref('AssetCategory'),'tags':arr(title)},
'FileObject':{'file_status':ref('FileStatus')},'AssetVersion':{'preview_status':ref('PreviewStatus')},
'Topic':{'status':ref('TopicStatus'),'parent_topic_id':nullable(ref('Id')),'assumptions':arr(string),'score_breakdown':arr({'type':'object'})},'Review':{'status':ref('ReviewStatus')},
'SourceConnection':{'health':ref('SourceHealth'),'capabilities':ref('Capabilities'),'source_type':ref('SourceType')},
'Job':{'state':ref('JobStatus')},'CollectionRun':{'state':ref('JobStatus')},'ImportBatch':{'status':ref('ImportStatus')},'ImportRow':{'status':ref('ImportRowStatus')},
'Publication':{'current_revision_id':ref('Id'),'traffic_type':ref('TrafficType'),'lifecycle':enum('active','deleted')},
'MetricObservation':{'aggregation_kind':enum('snapshot','cumulative','interval','rate','duration'),'value':nullable(ref('Decimal')),'is_approximate':boolean,'traffic_type':ref('TrafficType'),'validity':enum('confirmed','superseded','reverted')},
'Notification':{'channel':{'const':'in_app'},'read_at':nullable(timestamp),'superseded_at':nullable(timestamp)},
'Feedback':{'consent_status':ref('ConsentStatus'),'status':enum('new','triaged','archived')},'Report':{'status':ref('ReportStatus'),'payload':ref('ReportPayload'),'observation_ids':ids},'CalendarEvent':{'kind':ref('EventKind'),'event_version':version}}
for name,props in refinements.items(): S[name]['allOf'][1]['properties'].update(props)
# Machine-readable supplemental entities needed by business guarantees.
for name,props in {
'IdempotencyRecord':{'actor_id':ref('Id'),'method':title,'route':title,'idempotency_key':title,'request_hash':title,'response_ref':ref('Id'),'expires_at':timestamp},
'Calculation':{'account_id':ref('Id'),'metric_key':title,'input_observation_ids':ids,'calculation_version':title,'value':nullable(ref('Decimal')),'missing_reason':nullable(string),'window_start':nullable(timestamp),'window_end':nullable(timestamp)},
'MetricEvidence':{'observation_id':ref('Id'),'import_row_id':ref('Id'),'source_file_id':nullable(ref('Id')),'active':boolean},
'ObservationSupersession':{'old_id':ref('Id'),'new_id':ref('Id'),'batch_id':ref('Id'),'reason':string},
'ScheduleProposal':{'state':enum('proposed','applied','expired'),'input_versions':{'type':'object','additionalProperties':version},'proposed_events':arr(ref('CalendarEvent'))}}.items():S[name]={'allOf':[ref('BaseEntity'),obj(props,(),False)]}
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
req('AcceptTopic',{'media_type':ref('MediaType'),'owner_id':ref('Id'),'expected_version':version},['media_type','owner_id','expected_version'])
req('TopicVariant',{'goal':string,'media_type':ref('MediaType')},['goal','media_type'])
req('ContentCreate',{'account_id':ref('Id'),'media_type':ref('MediaType'),'owner_id':ref('Id'),'title':title},['account_id','media_type','owner_id','title'])
req('GenerateBrief',{'base_revision_id':ref('Id'),'instruction':string,'preserve_fields':arr(title)},['base_revision_id','preserve_fields'])
req('ApplyGenerated',{'result_revision_id':ref('Id'),'expected_version':version},['result_revision_id','expected_version'])
req('SubmitReview',{'revision_id':ref('Id'),'expected_version':version},['revision_id','expected_version'])
req('ReviewDecision',{'decision':enum('approve','reject'),'checklist':arr(obj({'key':title,'passed':boolean,'note':string},['key','passed'])),'comment':string,'revision_id':ref('Id'),'expected_version':version},['decision','checklist','revision_id','expected_version'])
S['ReviewDecision']['allOf']=[{'if':{'properties':{'decision':{'const':'reject'}}},'then':{'required':['comment'],'properties':{'comment':{'type':'string','minLength':1}}}}]
req('ExportPackage',{'approved_revision_id':ref('Id')},['approved_revision_id'])
req('PublicationDraftCreate',{'content_id':ref('Id'),'revision_id':ref('Id'),'partial_fields':{'type':'object'},'verification_note':string},['content_id','revision_id','partial_fields'])
req('PublicationCreate',{'content_id':ref('Id'),'approved_revision_id':ref('Id'),'platform_note_id':title,'url':ref('Url'),'published_at':timestamp,'traffic_type':ref('TrafficType'),'is_campaign':boolean},['content_id','approved_revision_id','platform_note_id','url','published_at','traffic_type','is_campaign'])
req('PublicationChangeCreate',{'kind':enum('edited','deleted','reposted'),'evidence':string,'actual_revision_id':ref('Id'),'reposted_publication_id':ref('Id'),'occurred_at':timestamp,'expected_version':version},['kind','evidence','occurred_at','expected_version'])
S['PublicationChangeCreate']['allOf']=[{'if':{'properties':{'kind':{'const':'edited'}}},'then':{'required':['actual_revision_id']}},{'if':{'properties':{'kind':{'const':'reposted'}}},'then':{'required':['reposted_publication_id']}}]
req('RevisionWorkItem',{'owner_id':ref('Id'),**reason},['owner_id','reason','expected_version'])
feedback={'publication_id':nullable(ref('Id')),'source_url':nullable(ref('Url')),'text':string,'source_time':nullable(timestamp),'category':title,'author_alias':nullable(title),'consent_status':ref('ConsentStatus'),'permitted_usage':string,'reply_draft':nullable(string),'status':enum('new','triaged','archived')}
req('FeedbackCreate',feedback,['text','consent_status','permitted_usage']);req('FeedbackPatch',{**feedback,'expected_version':version},['expected_version'])
req('UploadCreate',{'name':title,'size_bytes':{'type':'integer','minimum':1,'maximum':2147483648},'mime_hint':title,'sha256':{'type':'string','pattern':'^[a-f0-9]{64}$'},'purpose':title},['name','size_bytes','mime_hint','purpose'])
req('UploadPart',{'part_number':{'type':'integer','minimum':1},'checksum':title},['part_number','checksum'])
req('UploadComplete',{'parts_manifest':{'type':'array','minItems':1,'items':obj({'part_number':{'type':'integer','minimum':1},'etag':title,'checksum':title},['part_number','etag','checksum'])}},['parts_manifest'])
req('UploadAbort',{'reason':string})
asset={'name':title,'category':ref('AssetCategory'),'source_file_id':ref('Id'),'ip_identity':title,'folder_id':nullable(ref('Id')),'tags':arr(title),'owner_id':ref('Id'),'source':string,'series':title}
req('AssetCreate',asset,['name','category','source_file_id','ip_identity','owner_id','source']);req('AssetPatch',{k:v for k,v in {**asset,'expected_version':version}.items() if k!='source_file_id'},['expected_version'])
req('AssetVersionCreate',{'source_file_id':ref('Id'),'usage_scope':string,'dependencies':ids,'preview_file_id':nullable(ref('Id')),'base_version':version},['source_file_id','usage_scope','dependencies','base_version'])
req('AssetConfirm',{'usage_scope':string,'checklist':arr(title),'expected_version':version},['usage_scope','checklist','expected_version'])
req('AssetUsageCreate',{'asset_version_id':ref('Id'),'revision_id':ref('Id'),'role':title,'clip_range':obj({'start_ms':integer,'end_ms':integer},['start_ms','end_ms']),'expected_version':version},['asset_version_id','revision_id','role','expected_version'])
req('FolderCreate',{'name':title,'parent_id':nullable(ref('Id'))},['name']);req('FolderPatch',{'name':title,'parent_id':nullable(ref('Id')),'expected_version':version},['expected_version'])
req('RuleSetCreate',{'edition':title,'source_file_id':ref('Id'),'rules':arr(obj({'category':title,'rule_text':string,'source_page':{'type':'integer','minimum':1},'severity':title,'uncertainty_note':nullable(string)},['category','rule_text','source_page','severity']))},['edition','source_file_id','rules'])
req('RuleSetActivate',{'checklist':arr(title),'expected_version':version},['checklist','expected_version'])
req('ScheduleProposalCreate',{'content_ids':ids,'capacity':{'type':'object'},'period':obj({'start':timestamp,'end':timestamp},['start','end']),'constraints':arr(string)},['content_ids','capacity','period','constraints'])
req('ScheduleApply',{'accepted_changes':arr(ref('CalendarEvent')),'expected_versions':{'type':'object','additionalProperties':version}},['accepted_changes','expected_versions'])
event={'kind':ref('EventKind'),'content_id':nullable(ref('Id')),'publication_id':nullable(ref('Id')),'account_id':ref('Id'),'start_at':timestamp,'end_at':nullable(timestamp),'timezone':ref('Timezone'),'owner_id':ref('Id'),'dependency_ids':ids,'exception_reason':string}
req('EventCreate',event,['kind','account_id','start_at','timezone','owner_id']);req('EventPatch',{**event,'expected_version':version},['expected_version'])
req('DrawCampaign',{'actual_drawn_at':timestamp,'draw_record':{'type':'string','minLength':1},'expected_version':version},['actual_drawn_at','draw_record','expected_version'])
req('AnnounceCampaign',{'announced_at':timestamp,'announcement_record':{'type':'string','minLength':1},'expected_version':version},['announced_at','announcement_record','expected_version'])
req('CorrectCampaign',{'target_state':ref('CampaignStatus'),'reason':title,'evidence':string,'expected_version':version},['target_state','reason','evidence','expected_version'])
req('ImportCreate',{'account_id':ref('Id'),'file_ids':ids,'source_type':enum('screenshot','csv','xlsx','manual'),'hint':string,'manual_rows':arr(ref('MetricInput'))},['account_id','file_ids','source_type'])
S['ImportCreate']['allOf']=[{'if':{'properties':{'source_type':{'const':'manual'}}},'then':{'required':['manual_rows'],'properties':{'manual_rows':{'minItems':1}}},'else':{'properties':{'file_ids':{'minItems':1}}}}]
req('ImportRowPatch',{'metric':ref('MetricInput'),'status':enum('valid','excluded'),'expected_version':version},['expected_version'])
req('ImportConfirm',{'row_ids':{'type':'array','items':ref('Id'),'minItems':1,'uniqueItems':True},'conflict_resolutions':arr(obj({'row_id':ref('Id'),'resolution':enum('keep_existing','replace'),'existing_observation_id':ref('Id')},['row_id','resolution','existing_observation_id'])),'expected_version':version},['row_ids','conflict_resolutions','expected_version'])
req('ReportCreate',{'account_id':ref('Id'),'period':obj({'start':timestamp,'end':timestamp},['start','end']),'filters':obj({'media_type':ref('MediaType'),'traffic_type':ref('TrafficType'),'is_campaign':boolean})},['account_id','period'])
req('ReportAcceptActions',{'action_ids':ids,'expected_version':version},['action_ids','expected_version'])
req('AssetRelationCreate',{'from_version_id':ref('Id'),'to_version_id':ref('Id'),'relation_type':enum('source_of','render_of','derived_from')},['from_version_id','to_version_id','relation_type'])
# Derive and expand the documented routes, preserving source descriptions.
paths={}
def add(method,path,description):
 path=path.replace('或resume或cancel','')
 op={'operationId':method.lower()+'_'+re.sub(r'[^a-z0-9]+','_',path.lower()).strip('_'),'summary':description.split('；')[0][:120],'description':description,'security':[{'sessionCookie':[]}],'parameters':[],'responses':{}}
 for param in re.findall(r'{([^}]+)}',path):op['parameters'].append({'name':param,'in':'path','required':True,'schema':ref('Id')})
 if method=='GET':
  for name,schema in {'workspace_id':ref('Id'),'account_id':ref('Id'),'cursor':string,'limit':{'type':'integer','minimum':1,'maximum':100,'default':20},'start':timestamp,'end':timestamp,'sort':title,'status':title,'owner_id':ref('Id'),'media_type':ref('MediaType'),'traffic_type':ref('TrafficType'),'kind':title,'revision_id':ref('Id'),'purpose':title,'unread':boolean,'problem_only':boolean,'keys':arr(title),'publication_id':ref('Id'),'source_type':ref('SourceType'),'freshness':title,'keyword':title,'date':{'type':'string','format':'date'},'timezone':ref('Timezone'),'captured_after':timestamp}.items():op['parameters'].append({'name':name,'in':'query','required':False,'schema':schema})
 else:
  op['parameters'].append({'name':'Idempotency-Key','in':'header','required':True,'schema':{'type':'string','minLength':1,'maxLength':200}})
  op['parameters'].append({'name':'X-CSRF-Token','in':'header','required':True,'schema':title})
 paths.setdefault(path,{})[method.lower()]=op
contract=(root/'docs/yoyo-workbench-v1.0/06-接口契约.md').read_text()
collection={'members','assets','feedback','folders','calendar-events','campaigns'}
for line in contract.splitlines():
 if not line.startswith('| '):continue
 cols=[x.strip() for x in line.split('|')[1:-1]]
 if len(cols)!=3:continue
 match=re.match(r'((?:GET|POST|PATCH|PUT|DELETE)(?:/(?:GET|POST|PATCH|PUT|DELETE))*) (/[\w/{}/-]+)(.*)',cols[0])
 if not match:continue
 methods,path,tail=match.groups()
 alternatives=[path]
 if '或resume或cancel' in tail:alternatives=[path,path.rsplit('/',1)[0]+'/resume',path.rsplit('/',1)[0]+'/cancel']
 for method in methods.split('/'):
  for route in alternatives:
   if method=='PATCH' and route.strip('/') in collection:route+='/{id}'
   add(method,route,cols[2])
extras=[('POST','/contents/{id}/start-production','进入制作状态'),('POST','/contents/{id}/create-revision-work-item','创建已发布内容的修订工作项'),('POST','/campaigns/{id}/correct-state','管理员纠错，保留历史'),('GET','/imports/template','返回当前导入模板'),('POST','/jobs/{id}/retry','仅失败任务可重试；复查权限、预算和输入版本'),('GET','/files/{id}/preview','授权访问预览代理'),('GET','/assets/{id}/versions','版本历史'),('GET','/asset-relations','来源与衍生关系'),('POST','/asset-relations','拒绝跨区关系和循环依赖'),('POST','/reports/{id}/review','人工确认报告，不自动激活策略'),('GET','/auth/csrf','预登录及已登录会话CSRF令牌'),('POST','/auth/login','内部邀请账号登录'),('POST','/auth/logout','注销当前会话'),('GET','/auth/session','返回会话和成员状态')]
for name in ['members','assets','feedback','folders','calendar-events','campaigns','rule-sets','publications','topics','source-connections']:
 if '/'+name+'/{id}' not in paths or 'get' not in paths['/'+name+'/{id}']:extras.append(('GET','/'+name+'/{id}','返回实体详情及版本'))
extras.extend([('PUT','/assets/{id}/favorite','收藏幂等'),('DELETE','/assets/{id}/favorite','取消收藏幂等')])
for method,path,desc in extras:add(method,path,desc)
request_map={
'/accounts/{id}':{'patch':'AccountPatch'},'/settings':{'patch':'SettingsPatch'},'/members':{'post':'MemberCreate'},'/members/{id}':{'patch':'MemberPatch'},
'/source-connections':{'post':'SourceCreate'},'/source-connections/{id}':{'patch':'SourcePatch'},'/source-connections/{id}/refresh':{'post':'RefreshSource'},
'/topic-generations':{'post':'TopicGeneration'},'/topics/{id}/accept':{'post':'AcceptTopic'},'/topics/{id}/reject':{'post':'ReasonVersion'},'/topics/{id}/variants':{'post':'TopicVariant'},
'/contents':{'post':'ContentCreate'},'/contents/{id}/revisions':{'post':'ContentRevisionInput'},'/contents/{id}/generate-brief':{'post':'GenerateBrief'},'/contents/{id}/apply-generated':{'post':'ApplyGenerated'},'/contents/{id}/submit-review':{'post':'SubmitReview'},'/reviews/{id}/decide':{'post':'ReviewDecision'},'/reviews/{id}/withdraw':{'post':'ReasonVersion'},'/contents/{id}/export-package':{'post':'ExportPackage'},'/contents/{id}/cancel':{'post':'ReasonVersion'},'/contents/{id}/start-production':{'post':'ExpectedVersion'},'/contents/{id}/create-revision-work-item':{'post':'RevisionWorkItem'},
'/publication-drafts':{'post':'PublicationDraftCreate'},'/publications':{'post':'PublicationCreate'},'/publications/{id}/changes':{'post':'PublicationChangeCreate'},'/feedback':{'post':'FeedbackCreate'},'/feedback/{id}':{'patch':'FeedbackPatch'},
'/uploads':{'post':'UploadCreate'},'/uploads/{id}/parts':{'post':'UploadPart'},'/uploads/{id}/complete':{'post':'UploadComplete'},'/uploads/{id}/abort':{'post':'UploadAbort'},'/assets':{'post':'AssetCreate'},'/assets/{id}':{'patch':'AssetPatch'},'/assets/{id}/versions':{'post':'AssetVersionCreate'},'/asset-versions/{id}/confirm':{'post':'AssetConfirm'},'/assets/{id}/retire':{'post':'ReasonVersion'},'/asset-usages':{'post':'AssetUsageCreate'},'/asset-relations':{'post':'AssetRelationCreate'},'/folders':{'post':'FolderCreate'},'/folders/{id}':{'patch':'FolderPatch'},'/rule-sets':{'post':'RuleSetCreate'},'/rule-sets/{id}/activate':{'post':'RuleSetActivate'},
'/schedule-proposals':{'post':'ScheduleProposalCreate'},'/schedule-proposals/{id}/apply':{'post':'ScheduleApply'},'/calendar-events':{'post':'EventCreate'},'/calendar-events/{id}':{'patch':'EventPatch'},'/campaigns':{'post':'CampaignCreate'},'/campaigns/{id}':{'patch':'CampaignPatch'},'/campaigns/{id}/activate':{'post':'ExpectedVersion'},'/campaigns/{id}/draw':{'post':'DrawCampaign'},'/campaigns/{id}/announce':{'post':'AnnounceCampaign'},'/campaigns/{id}/pause':{'post':'ReasonVersion'},'/campaigns/{id}/resume':{'post':'ReasonVersion'},'/campaigns/{id}/cancel':{'post':'ReasonVersion'},'/campaigns/{id}/correct-state':{'post':'CorrectCampaign'},
'/imports':{'post':'ImportCreate'},'/import-rows/{id}':{'patch':'ImportRowPatch'},'/imports/{id}/confirm':{'post':'ImportConfirm'},'/imports/{id}/revert':{'post':'ReasonVersion'},'/reports':{'post':'ReportCreate'},'/reports/{id}/accept-actions':{'post':'ReportAcceptActions'},'/reports/{id}/review':{'post':'ExpectedVersion'},'/strategy-memories/{id}/activate':{'post':'ReasonVersion'},'/jobs/{id}/cancel':{'post':'ReasonVersion'},'/jobs/{id}/retry':{'post':'ReasonVersion'},'/auth/login':{'post':'Login'}}
resource={'accounts':'SocialAccount','members':'Membership','source-connections':'SourceConnection','source-items':'SourceItem','topics':'Topic','contents':'Content','feedback':'Feedback','assets':'Asset','folders':'Folder','rule-sets':'BrandRuleSet','campaigns':'Campaign','calendar-events':'CalendarEvent','notifications':'Notification','publications':'Publication','reports':'Report','jobs':'Job','imports':'ImportBatch','import-rows':'ImportRow','uploads':'UploadSession','asset-relations':'AssetRelation','audit-logs':'AuditLog','asset-usages':'AssetUsage'}
async_paths={'/source-connections/{id}/verify','/source-connections/{id}/refresh','/topic-generations','/contents/{id}/generate-brief','/contents/{id}/export-package','/schedule-proposals','/imports','/reports','/jobs/{id}/retry'}
S['Session']=obj({'authenticated':boolean,'user_id':nullable(ref('Id')),'workspace_id':nullable(ref('Id')),'roles':arr(ref('Role')),'expires_at':nullable(timestamp)},['authenticated','user_id','workspace_id','roles','expires_at'])
S['Csrf']=obj({'csrf_token':title},['csrf_token'])
S['Download']=obj({'url':ref('Url'),'expires_at':timestamp},['url','expires_at'])
S['TopicAccepted']=obj({'content_id':ref('Id'),'revision_id':ref('Id'),'brief_job_id':ref('Id')},['content_id','revision_id','brief_job_id'])
S['Dashboard']=obj({'metrics':arr(ref('MetricObservation')),'priority_tasks':{'type':'array','maxItems':3,'items':{'type':'object'}},'missing_data':arr(string),'source_health':arr(ref('SourceConnection')),'campaigns':arr(ref('Campaign'))},['metrics','priority_tasks','missing_data','source_health','campaigns'])
S['Settings']=obj({'timezone':ref('Timezone'),'daily_ai_budget':nullable(ref('Decimal')),'max_file_size_bytes':integer,'source_frequency':title},(),False)
S['Success']=obj({'ok':boolean},['ok'])
S['MetricResult']=obj({'observations':arr(ref('MetricObservation')),'calculations':arr(ref('Calculation'))},['observations','calculations'])
S['ImportTemplate']=obj({'version':title,'columns':arr(title),'example_rows_demo':arr(ref('MetricInput'))},['version','columns','example_rows_demo'])
for path,methods in paths.items():
 for method,op in methods.items():
  if method!='get':
   name=request_map.get(path,{}).get(method)
   if name:op['requestBody']={'required':True,'content':{'application/json':{'schema':ref(name)}}}
   elif path not in {'/source-connections/{id}/verify','/notifications/{id}/read','/assets/{id}/favorite','/auth/logout'}:raise ValueError('Missing request schema: '+method+' '+path)
  if path.startswith('/auth/'):
   op['security']=[] if path in {'/auth/login','/auth/csrf'} else [{'sessionCookie':[]}]
   if path=='/auth/login':op['parameters']=[p for p in op['parameters'] if p['name']!='Idempotency-Key']
  key=path.strip('/').split('/')[0]; entity=resource.get(key,'Success')
  data=ref(entity)
  if method=='get' and path=='/'+key and key in resource:data=obj({'items':arr(ref(entity)),'next_cursor':nullable(string)},['items','next_cursor'])
  if '/rows' in path:data=obj({'items':arr(ref('ImportRow')),'next_cursor':nullable(string)},['items','next_cursor'])
  if path=='/assets/{id}/versions' and method=='get':data=obj({'items':arr(ref('AssetVersion')),'next_cursor':nullable(string)},['items','next_cursor'])
  if path=='/assets/{id}/usages':data=obj({'items':arr(ref('AssetUsage')),'next_cursor':nullable(string)},['items','next_cursor'])
  if path in {'/files/{id}/download','/files/{id}/preview'}:data=ref('Download')
  if path=='/me' or path in {'/auth/session','/auth/login'}:data=ref('Session')
  if path=='/auth/csrf':data=ref('Csrf')
  if path=='/dashboard':data=ref('Dashboard')
  if path=='/settings':data=ref('Settings')
  if path=='/metrics':data=ref('MetricResult')
  if path=='/imports/template':data=ref('ImportTemplate')
  if path=='/topics/{id}/accept':data=ref('TopicAccepted')
  if path=='/contents/{id}/revisions':data=ref('ContentRevision')
  if path=='/contents/{id}/submit-review' or path.startswith('/reviews/'):data=ref('Review')
  if path=='/publication-drafts':data=ref('PublicationDraft')
  if path=='/asset-versions/{id}/confirm' or (path=='/assets/{id}/versions' and method=='post'):data=ref('AssetVersion')
  if path.startswith('/schedule-proposals/'):data=ref('ScheduleProposal')
  if path=='/uploads/{id}/complete':data=ref('FileObject')
  if path=='/uploads/{id}/parts':data=ref('Download')
  code='202' if path in async_paths and method=='post' else '201' if method=='post' and (path.count('/')==1 or path.endswith(('/revisions','/versions','/accept','/variants','/create-revision-work-item'))) else '200'
  if code=='202':data=ref('AcceptedJob')
  op['responses'][code]={'description':'成功；仅表示契约，运行实现待S1以后','content':{'application/json':{'schema':obj({'data':data,'meta':ref('Meta')},['data','meta'])}}}
  for error in ['401','403','404','409','422','429','503']:op['responses'][error]={'description':'权限、版本、业务校验或外部服务错误','content':{'application/json':{'schema':ref('ErrorEnvelope')}}}
  op['x-implementation-status']='planned'
  op['x-business-guards']=['workspace_membership','account_consistency']+(['optimistic_concurrency','transactional_audit'] if method!='get' else [])
spec={'openapi':'3.1.0','info':{'title':'YOYO 内部运营工作台','version':'1.0.0-s0','description':'设计基线的可校验内部契约。所有端点尚未实现，不是平台外部API。业务守卫见docs/decisions/ADR-002。'},'servers':[{'url':'http://localhost:3000/api/v1','description':'规划中的本地地址，尚未启动'}],'paths':paths,'components':{'securitySchemes':{'sessionCookie':{'type':'apiKey','in':'cookie','name':'yoyo_session'}},'schemas':S}}
(root/'contracts/openapi.json').write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
text=json.dumps({'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'urn:yoyo:domain:v1','$defs':S},ensure_ascii=False,indent=2).replace('#/components/schemas/','#/$defs/')
(root/'contracts/domain.schema.json').write_text(text+'\n')
manifest={'paths':len(paths),'operations':sum(len(v) for v in paths.values()),'schemas':len(S),'source_document':'docs/yoyo-workbench-v1.0/06-接口契约.md','implementation_status':'not_implemented'}
(root/'docs/evidence/s0/contract-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest))
