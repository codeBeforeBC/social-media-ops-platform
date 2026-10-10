"""v1.2 machine contracts: structural and representative request checks, not product tests."""
from pathlib import Path
import json,re,os
from jsonschema import Draft202012Validator,FormatChecker
from openapi_spec_validator import validate_spec
root=Path(__file__).resolve().parents[2]
spec=json.loads((root/'contracts/openapi.json').read_text());domain=json.loads((root/'contracts/domain.schema.json').read_text())
validate_spec(spec);Draft202012Validator.check_schema(domain)
ids=[]
for path,methods in spec['paths'].items():
 assert not re.match(r'^/(assets|asset-versions|asset-relations|asset-usages|folders|guideline-files|rule-sets|contents|content-revisions|reviews|export-packages|publication-drafts|calendar-events|campaigns|schedule-proposals)(/|$)',path),path
 assert not path.endswith('/changes')
 for method,op in methods.items():
  ids.append(op['operationId']);assert {p['name'] for p in op['parameters'] if p['in']=='path'}==set(re.findall(r'{([^}]+)}',path)),path
  if method in ('post','patch','put','delete'):assert any(p['name']=='X-CSRF-Token' and p['required'] for p in op['parameters'])
  if method=='patch':
   request=op['requestBody']['content']['application/json']['schema']['$ref'].split('/')[-1];assert 'expected_version' in domain['$defs'][request]['required']
assert len(ids)==len(set(ids))
assert domain['$defs']['Role']['enum']==['admin','editor','operator','viewer']
assert domain['$defs']['DiagnosticInput']['properties']['pool']['enum']==['general']
assert not any(re.search(r'(Asset|Content|Review|Campaign|Calendar|Reminder|Schedule|Brief|GraphicPage|VideoShot|Deliverable|BrandRule)',n) for n in domain['$defs'])
assert 'required_asset_ids' not in json.dumps(domain)
assert 'is_campaign' not in json.dumps(domain)
# All references resolve, including schemas not currently reachable from implemented endpoints.
def refs(v):
 if isinstance(v,dict):
  if '$ref' in v:assert v['$ref'].split('/')[-1] in domain['$defs'],v['$ref']
  for x in v.values():refs(x)
 elif isinstance(v,list):
  for x in v:refs(x)
refs(domain)
u='a1000000-0000-4000-8000-000000000001';stamp='2026-10-09T00:00:00Z'
accepted={'decision_id':u,'topic_id':u,'status':'accepted','version':2}
note={'account_id':u,'platform_note_id':'note1','url':'https://www.xiaohongshu.com/explore/note1','title':'合成笔记','media_type':'graphic','published_at':stamp,'traffic_type':'unknown'}
file={'name':'截图.png','size_bytes':32,'mime_hint':'image/png','purpose':'import_screenshot','account_id':u}
cases=[('AcceptTopic',{'expected_version':1},True),('AcceptTopic',{'expected_version':1,'owner_id':u},True),('AcceptTopic',{'expected_version':1,'media_type':'graphic'},False),('TopicAccepted',accepted,True),('TopicAccepted',{'content_id':u,'revision_id':u,'brief_job_id':u},False),('PublicationCreate',note,True),('PublicationCreate',{**note,'is_campaign':False},False),('PublicationCreate',{**note,'content_id':u},False),('PublicationCreate',{k:v for k,v in note.items() if k!='platform_note_id'},False),('PublicationPatch',{'expected_version':1,'reason':'核对原帖','title':'改标题'},True),('PublicationPatch',{'expected_version':1,'title':'改标题'},False),('PublicationPatch',{'expected_version':1,'reason':'换ID','platform_note_id':'new'},False),('UploadCreate',file,True),('UploadCreate',{**file,'purpose':'asset'},False),('UploadCreate',{**file,'purpose':'guideline'},False),('UploadCreate',{**file,'purpose':'campaign_evidence'},False),('UploadCreate',{k:v for k,v in file.items() if k!='account_id'},False),('UploadCreate',{**file,'purpose':'import_table','name':'表.csv','mime_hint':'text/csv'},True),('DiagnosticInput',{'pool':'general'},True),('DiagnosticInput',{'pool':'reminder'},False),('MemberCreate',{'email':'test@example.invalid','roles':['viewer']},True),('MemberCreate',{'email':'test@example.invalid','roles':['reviewer']},False)]
output={'schema_version':'ai-v1.2','input_version':'synthetic','summary':'合成','evidence_refs':[],'assumptions':[],'missing_inputs':[],'warnings':[],'task_payload':{'candidates':[]}}
cases.extend([('UploadCreate',{**file,'size_bytes':20971521},False),('UploadCreate',{**file,'mime_hint':'application/pdf'},False),('AITopicOutput',output,True),('AITopicOutput',{**output,'task_payload':{'campaign':{}}},False)])
for name,payload,expected in cases:
 valid=Draft202012Validator({'$ref':'#/$defs/'+name,'$defs':domain['$defs']},format_checker=FormatChecker()).is_valid(payload)
 assert valid==expected,(name,payload,expected)
report={'version':'1.2.0','paths':len(spec['paths']),'operations':len(ids),'schemas':len(domain['$defs']),'samples':len(cases),'result':'passed','scope':'static schema only'}
Path(os.environ.get('CONTRACT_VALIDATION_REPORT',root/'docs/evidence/s11/contract-validation.json')).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
