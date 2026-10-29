"""Loaded by the contract generator after baseline construction. S0 evidence remains historical."""
S['ErrorEnvelope']['properties']['error']['properties']['field_errors']={'type':'object','additionalProperties':True}
S['Login']=obj({'email':{'type':'string','format':'email','maxLength':254},'password':{'type':'string','minLength':1,'maxLength':128},'workspace_id':ref('Id')},['email','password'])
S['SetupInput']=obj({'email':{'type':'string','format':'email'},'password':{'type':'string','minLength':12,'maxLength':128},'display_name':title,'workspace_name':title},['email','password','display_name','workspace_name'])
admin_roles={'type':'array','items':{'const':'admin'},'minItems':1,'maxItems':1}
S['MemberCreate']['properties']['roles']=admin_roles
S['MemberCreate']['required']=['email']
S['MemberPatch']['properties']['roles']=admin_roles
S['AcceptInvite']=obj({'invitation_token':title,'password':{'type':'string','minLength':12,'maxLength':128}},['invitation_token','password'])
S['AccountCreate']=obj({'platform':{'const':'xiaohongshu'},'platform_user_id':{'type':'string','minLength':1,'maxLength':2000,'pattern':r'^(?:[a-fA-F0-9]{24}|https://www\.xiaohongshu\.com/user/profile/[a-fA-F0-9]{24}/?(?:[?#][^\s]*)?)$'},'display_handle':title,'name':title,'timezone':ref('Timezone')},['platform','platform_user_id','name'])
S['DiagnosticInput']=obj({'pool':enum('general'),'account_id':ref('Id')},['pool'])
S['JobReason']=obj({'reason':{'type':'string','minLength':1,'maxLength':1000}},['reason'])
S['LoginSession']=obj({'authenticated':{'const':True},'csrf_token':title,'expires_at':timestamp},['authenticated','csrf_token','expires_at'])
S['Session']=obj({'user':obj({'id':ref('Id'),'email':{'type':'string','format':'email'},'display_name':title},['id','email','display_name']),
 'membership':obj({'id':ref('Id'),'roles':arr(ref('Role')),'workspace_id':ref('Id')},['id','roles','workspace_id']),
 'workspace':obj({'id':ref('Id'),'name':title,'timezone':ref('Timezone'),'settings':{'type':'object'},'version':version,'created_at':timestamp,'updated_at':timestamp},['id','name','timezone','settings','version','created_at','updated_at']),
 'permissions':arr(title),'expires_at':timestamp},['user','membership','workspace','permissions','expires_at'])
S['SocialAccount']=obj({'id':ref('Id'),'workspace_id':ref('Id'),'platform':enum('weibo','xiaohongshu'),'platform_user_id':title,'display_handle':{'type':'string'},'name':title,'profile_url':nullable(ref('Url')),'owner_id':ref('Id'),'timezone':ref('Timezone'),'version':version,'created_at':timestamp,'updated_at':timestamp},['id','workspace_id','platform','platform_user_id','name','owner_id','timezone','version','created_at','updated_at'])
S['S1Settings']=obj({'id':ref('Id'),'name':title,'timezone':ref('Timezone'),'settings':{'type':'object'},'version':version},['id','name','timezone','settings','version'])
S['Notification']=obj({'id':ref('Id'),'workspace_id':ref('Id'),'recipient_id':ref('Id'),'event_key':title,'job_id':nullable(ref('Id')),'channel':{'const':'in_app'},'title':title,'task_ref':nullable(string),'read_at':nullable(timestamp),'superseded_at':nullable(timestamp),'created_at':timestamp},['id','workspace_id','recipient_id','channel','title','read_at','superseded_at','created_at'])
S['AuditLog']=obj({'id':ref('Id'),'workspace_id':ref('Id'),'actor_id':nullable(ref('Id')),'actor_type':enum('user','service'),'action':title,'object_type':title,'object_id':nullable(ref('Id')),'details':{'type':'object'},'request_id':ref('Id'),'occurred_at':timestamp},['id','workspace_id','actor_type','action','request_id','occurred_at'])
S['S1Dashboard']=obj({'stage':{'const':'S1'},'metrics':{'type':'null'},'priority_tasks':{'type':'array','maxItems':3,'items':{'type':'object'}},'external_capabilities':{'type':'object'}},['stage','metrics','priority_tasks','external_capabilities'])
S['Monitor']=obj({'jobs':arr({'type':'object'}),'processes':arr({'type':'object'}),'outbox_pending':integer,'external_capabilities':{'type':'object'}},['jobs','processes','outbox_pending','external_capabilities'])
S['DiagnosticAccepted']=obj({'event_id':ref('Id'),'job_id':ref('Id'),'status_url':ref('Url'),'state':{'const':'queued'}},['event_id','job_id','status_url','state'])
def listing(name):return obj({'items':arr(ref(name)),'next_cursor':nullable(string)},['items','next_cursor'])
def s1(method,path,response,code='200',request=None,public=False):
 if path not in paths or method not in paths[path]:add(method.upper(),path,'S1基础系统接口')
 op=paths[path][method]
 if public:op['security']=[]
 if request:op['requestBody']={'required':True,'content':{'application/json':{'schema':ref(request)}}}
 if public:op['parameters']=[p for p in op['parameters'] if p['name']!='Idempotency-Key']
 if method=='get':
  supported={'/members':['cursor','limit','sort'],'/jobs':['cursor','limit','sort'],'/notifications':['cursor','limit','sort','unread'],'/audit-logs':['cursor','limit','sort','start','end'],'/dashboard':['account_id'],'/me':['workspace_id'],'/auth/session':['workspace_id']}.get(path,[])
  op['parameters']=[p for p in op['parameters'] if p['in']=='path' or p['name'] in supported]
 op['responses']={k:v for k,v in op.get('responses',{}).items() if not k.startswith('2')}
 op['responses'][code]={'description':'S1实现；验收范围见docs/evidence/s1/README.md','content':{'application/json':{'schema':obj({'data':response,'meta':ref('Meta')},['data','meta'])}}}
 op['responses']['500']={'description':'内部错误（脱敏）','content':{'application/json':{'schema':ref('ErrorEnvelope')}}}
 for error in ['401','403','404','409','422','429','503']:
  op['responses'][error]={'description':'权限、会话、输入或并发错误','content':{'application/json':{'schema':ref('ErrorEnvelope')}}}
 op['x-implementation-status']='implemented'
for method,path,response,code,request,public in [
 ('get','/health',obj({'status':{'const':'ok'}},['status']),'200',None,True),
 ('get','/setup/status',obj({'initialized':boolean},['initialized']),'200',None,True),
 ('post','/setup',obj({'initialized':{'const':True}},['initialized']),'201','SetupInput',True),
 ('get','/auth/csrf',ref('Csrf'),'200',None,True),
 ('post','/auth/login',ref('LoginSession'),'200','Login',True),
 ('post','/auth/accept-invite',obj({'accepted':{'const':True}},['accepted']),'200','AcceptInvite',True),
 ('post','/auth/logout',obj({'success':{'const':True}},['success']),'200',None,False),
 ('get','/auth/session',ref('Session'),'200',None,False),('get','/me',ref('Session'),'200',None,False),
 ('get','/accounts',obj({'items':arr(ref('SocialAccount'))},['items']),'200',None,False),
 ('post','/accounts',ref('SocialAccount'),'201','AccountCreate',False),
 ('get','/accounts/{id}',ref('SocialAccount'),'200',None,False),('patch','/accounts/{id}',ref('SocialAccount'),'200','AccountPatch',False),
 ('get','/settings',ref('S1Settings'),'200',None,False),('patch','/settings',ref('S1Settings'),'200','SettingsPatch',False),
 ('get','/members',listing('Membership'),'200',None,False),('post','/members',ref('Membership'),'201','MemberCreate',False),('patch','/members/{id}',ref('Membership'),'200','MemberPatch',False),
 ('get','/audit-logs',listing('AuditLog'),'200',None,False),('get','/notifications',listing('Notification'),'200',None,False),('post','/notifications/{id}/read',ref('Notification'),'200',None,False),
 ('get','/jobs',listing('Job'),'200',None,False),('get','/jobs/{id}',ref('Job'),'200',None,False),('post','/jobs/{id}/cancel',ref('Job'),'200','JobReason',False),('post','/jobs/{id}/retry',ref('Job'),'202','JobReason',False),
 ('post','/diagnostics',ref('DiagnosticAccepted'),'202','DiagnosticInput',False),('get','/monitor',ref('Monitor'),'200',None,False),('get','/dashboard',ref('S1Dashboard'),'200',None,False)
]:s1(method,path,response,code,request,public)
# 下载/预览保留planned：S1只有角色守卫，S2才返回真实签名地址。
# CHANGE-020: observed platform identity, current session, and human declaration are independent.
profile_ref={'type':'string','pattern':'^[A-Za-z0-9_-]{1,100}$'}
S['AccountCreate']['properties']['browser_profile_ref']=nullable(profile_ref)
S['AccountPatch']['properties']['browser_profile_ref']=nullable(profile_ref)
capability=enum('unknown','supported','unsupported')
S['AccountVerificationResult']=obj({'public_status':enum('matched','inconclusive','not_found'),'session_status':enum('unknown','matched','mismatched','auth_required','unsupported'),
 'public_profile':nullable(obj({'id':{'type':'string','pattern':'^[a-f0-9]{24}$'},'nickname':title,'display_handle':nullable(string)},['id','nickname','display_handle'])),
 'session_id':nullable({'type':'string','pattern':'^[a-f0-9]{24}$'}),'observed_at':timestamp,'adapter_version':title,
 'capabilities':obj({'public_identity':capability,'current_session_identity':capability,'own_account_metrics':capability},['public_identity','current_session_identity','own_account_metrics']),
 'error_code':nullable(string)},['public_status','session_status','public_profile','session_id','observed_at','adapter_version','capabilities','error_code'])
S['AccountVerification']=obj({'id':ref('Id'),'workspace_id':ref('Id'),'account_id':ref('Id'),'binding_version':version,'expected_platform_user_id':title,'browser_profile_ref':profile_ref,'requested_by':ref('Id'),'requested_at':timestamp,'job_id':ref('Id'),'result':nullable(ref('AccountVerificationResult')),'applied_at':nullable(timestamp),'state':enum('queued','running','succeeded','partial','failed','cancelled'),'started_at':nullable(timestamp),'finished_at':nullable(timestamp),'error_code':nullable(string)},['id','workspace_id','account_id','binding_version','expected_platform_user_id','browser_profile_ref','requested_by','requested_at','job_id','result','applied_at','state','started_at','finished_at','error_code'])
S['AccountVerificationSummary']=obj({'latest':nullable(ref('AccountVerification')),'last_success':nullable(ref('AccountVerification')),'current':boolean,'stale':boolean,'confirmed':boolean,'as_of':timestamp},['latest','last_success','current','stale','confirmed','as_of'])
S['SocialAccount']['properties'].update({'browser_profile_ref':nullable(profile_ref),'identity_binding_version':version,'confirmed_verification_id':nullable(ref('Id')),'confirmed_at':nullable(timestamp),'verification_next_at':nullable(timestamp),'verification':ref('AccountVerificationSummary')})
S['AccountVerificationCreate']=obj({'expected_version':version,'binding_version':version},['expected_version','binding_version'])
S['AccountIdentityConfirm']=obj({'verification_id':ref('Id'),'expected_version':version,'confirmed':{'const':True}},['verification_id','expected_version','confirmed'])
S['AccountVerificationAccepted']=obj({'verification':ref('AccountVerification'),'reused':boolean},['verification','reused'])
s1('get','/account-browser-profiles',obj({'items':arr(obj({'id':profile_ref},['id']))},['items']))
s1('post','/accounts/{id}/verifications',ref('AccountVerificationAccepted'),'202','AccountVerificationCreate')
s1('get','/accounts/{id}/verifications',obj({'items':arr(ref('AccountVerification')),'next_cursor':nullable(string)},['items','next_cursor']))
s1('get','/accounts/{id}/verifications/{verification_id}',ref('AccountVerification'))
s1('post','/accounts/{id}/identity-confirmation',ref('SocialAccount'),'200','AccountIdentityConfirm')
paths['/accounts/{id}/verifications']['get']['parameters'] += [{'name':name,'in':'query','required':False,'schema':{'type':'string'}} for name in ['cursor','limit']]
# CHANGE-023: physical deletion is limited to accounts without referenced history.
S['AccountDelete']=obj({'expected_version':version,'confirmed':{'const':True}},['expected_version','confirmed'])
S['AccountDeleted']=obj({'account_id':ref('Id'),'deleted':{'const':True}},['account_id','deleted'])
s1('delete','/accounts/{id}',ref('AccountDeleted'),'200','AccountDelete')
# CHANGE-025: durable force-deletion operation survives account and business cleanup.
S['SocialAccount']['properties']['deletion_operation_id']=nullable(ref('Id'))
S['Job']['allOf'][1]['properties']['execution_finished_at']=nullable(timestamp)
S['AccountDeletion']=obj({'id':ref('Id'),'workspace_id':ref('Id'),'account_id':ref('Id'),'account_name':nullable(string),'state':enum('stopping','backing_up','purging','cleaning_files','completed','failed'),'phase':string,'counts':{'type':'object','additionalProperties':integer},'error_code':nullable(string),'created_at':timestamp,'updated_at':timestamp,'finished_at':nullable(timestamp),'backup_available':boolean,'job_state':nullable(enum('queued','running','succeeded','partial','failed','cancelled')),'attempts':nullable(integer)},['id','workspace_id','account_id','account_name','state','phase','counts','error_code','created_at','updated_at','finished_at','backup_available','job_state','attempts'])
S['AccountDeletionImpact']=obj({'account_id':ref('Id'),'expected_version':version,'operation':ref('AccountDeletion'),'fingerprint':{'type':'string','pattern':'^[a-f0-9]{64}$'},'counts':{'type':'object','additionalProperties':integer},'file_count':integer,'retained_shared_files':integer,'shared_data_preserved':boolean},['account_id','expected_version'])
S['AccountForceDelete']=obj({'expected_version':version,'confirmed':{'const':True},'force':{'const':True},'fingerprint':{'type':'string','pattern':'^[a-f0-9]{64}$'}},['expected_version','confirmed','force','fingerprint'])
S['AccountEmptyDelete']=S['AccountDelete'];S['AccountDelete']={'oneOf':[ref('AccountEmptyDelete'),ref('AccountForceDelete')]}
S['AccountDeletionAccepted']=obj({'operation':ref('AccountDeletion'),'reused':boolean},['operation','reused'])
paths['/accounts/{id}']['delete']['responses']['202']={'description':'账号及专属数据删除已受理，状态以独立操作为准','content':{'application/json':{'schema':obj({'data':ref('AccountDeletionAccepted'),'meta':ref('Meta')},['data','meta'])}}}
s1('get','/accounts/{id}/deletion-impact',ref('AccountDeletionImpact'))
s1('get','/account-deletions',obj({'items':arr(ref('AccountDeletion'))},['items']))
s1('get','/account-deletions/{id}',ref('AccountDeletion'))
s1('post','/account-deletions/{id}/retry',ref('AccountDeletion'),'200')
