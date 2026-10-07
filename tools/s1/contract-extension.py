"""Loaded by the contract generator after baseline construction. S0 evidence remains historical."""
S['ErrorEnvelope']['properties']['error']['properties']['field_errors']={'type':'object','additionalProperties':True}
S['Login']=obj({'email':{'type':'string','format':'email','maxLength':254},'password':{'type':'string','minLength':1,'maxLength':128},'workspace_id':ref('Id')},['email','password'])
S['SetupInput']=obj({'email':{'type':'string','format':'email'},'password':{'type':'string','minLength':12,'maxLength':128},'display_name':title,'workspace_name':title,'setup_token':title},['email','password','display_name','workspace_name','setup_token'])
S['AcceptInvite']=obj({'invitation_token':title,'password':{'type':'string','minLength':12,'maxLength':128}},['invitation_token','password'])
S['AccountCreate']=obj({'platform':enum('weibo','xiaohongshu'),'platform_user_id':title,'display_handle':title,'name':title,'timezone':ref('Timezone')},['platform','platform_user_id','name'])
S['DiagnosticInput']=obj({'pool':enum('general','reminder'),'account_id':ref('Id')},['pool'])
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
