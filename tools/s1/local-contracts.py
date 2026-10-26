"""Final local-instance wire contract; historical generators remain reproducible inputs."""
from pathlib import Path
import json,re
root=Path(__file__).resolve().parents[2]
p=root/'contracts/openapi.json';spec=json.loads(p.read_text());S=spec['components']['schemas']
workspace=S['Session']['properties']['workspace']
S['LocalInstance']={'type':'object','properties':{'mode':{'const':'local'},'workspace':workspace},'required':['mode','workspace'],'additionalProperties':False}
for path in list(spec['paths']):
 if re.match(r'^/(setup|auth|members)(/|$)',path) or path=='/me':del spec['paths'][path]
for schema in ['SetupInput','Login','AcceptInvite','LoginSession','Session','MemberCreate','MemberPatch','Membership']:
 S.pop(schema,None)
for schema in ['AccountPatch','AcceptTopic']:
 S[schema]['properties'].pop('owner_id',None)
 if 'owner_id' in S[schema].get('required',[]):S[schema]['required'].remove('owner_id')
if 'TopicDetail' in S:S['TopicDetail']['properties'].pop('owner_options',None)
for path,methods in spec['paths'].items():
 for method,op in methods.items():
  op['security']=[]
  op['responses'].pop('401',None)
  if method!='get':op['responses']['415']={'description':'请求格式不受支持','content':{'application/json':{'schema':{'$ref':'#/components/schemas/ErrorEnvelope'}}}}
for path,name in [('/instance','LocalInstance'),('/request/csrf','Csrf')]:
 op={'operationId':'get_'+path.strip('/').replace('/','_'),'summary':'本机默认实例上下文' if path=='/instance' else '本机浏览器请求令牌（不是登录）','security':[],'parameters':[],'x-implementation-status':'implemented','responses':{}}
 op['responses']['200']={'description':'成功','content':{'application/json':{'schema':{'type':'object','properties':{'data':{'$ref':'#/components/schemas/'+name},'meta':{'$ref':'#/components/schemas/Meta'}},'required':['data','meta']}}}}
 for status in ['403','409','422','503','500']:op['responses'][status]={'description':'请求或实例上下文无效','content':{'application/json':{'schema':{'$ref':'#/components/schemas/ErrorEnvelope'}}}}
 spec['paths'][path]={'get':op}
spec['components']['securitySchemes']={}
spec['info']['description']='YOYO本地单实例API；默认身份由实例持久映射提供，无登录/成员功能。写请求保留Origin/CSRF及资源边界；旧身份接口返回410。'
p.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
