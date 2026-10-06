"""S0 schema validation, not implementation or live API acceptance tests.
Run in the isolated environment described in contracts/README.md.
"""
from pathlib import Path
from datetime import datetime, timezone
import copy, json, re
from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate_spec

root = Path(__file__).resolve().parents[2]
spec = json.loads((root / 'contracts/openapi.json').read_text())
domain = json.loads((root / 'contracts/domain.schema.json').read_text())
validate_spec(spec)
Draft202012Validator.check_schema(domain)
operation_ids = [op['operationId'] for methods in spec['paths'].values() for op in methods.values()]
assert len(operation_ids) == len(set(operation_ids))
for path, methods in spec['paths'].items():
    for method, op in methods.items():
        declared = {p['name'] for p in op['parameters'] if p['in'] == 'path'}
        assert declared == set(re.findall(r'{([^}]+)}', path))
        assert all(op['parameters'][i]['required'] for i,p in enumerate(op['parameters']) if p['in']=='path')
        if method in {'post', 'patch', 'put', 'delete'}:
            assert any(p['name'] == 'X-CSRF-Token' and p['required'] for p in op['parameters'])
        if method == 'patch':
            name=op['requestBody']['content']['application/json']['schema']['$ref'].split('/')[-1]
            assert 'expected_version' in spec['components']['schemas'][name]['required']

def validate(name, payload):
    schema = {'$schema': domain['$schema'], '$defs': domain['$defs'], '$ref': '#/$defs/' + name}
    return list(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(payload))

id = '10000000-0000-4000-8000-000000000001'
t = '2026-10-03T15:03:21Z'
upload={'name':'规范.pdf','size_bytes':409861466,'mime_hint':'application/pdf','purpose':'guideline'}
metric={'target':{'account_id':id},'metric_key':'followers_total','definition_version':1,'aggregation_kind':'snapshot','value':'631','unit':'person','observed_at':t,'traffic_type':'unknown','is_approximate':False}
revision={'base_revision_id':id,'expected_version':1,'title':'测试制作单','body':'合成测试','media_type':'graphic','pages':[{'position':1,'visual_instruction':'合成示例','page_copy':'合成示例'}]}
manual={'account_id':id,'file_ids':[],'source_type':'manual','manual_rows':[metric]}
review={'decision':'approve','checklist':[],'revision_id':id,'expected_version':1}
report={'facts':[{'claim':'合成测试','calculation_id':id,'observation_ids':[id]}],'hypotheses':[],'actions':[],'missing_data':[]}
cases=[]
def case(label, name, payload, accepted):cases.append((label,name,payload,accepted))
case('real_pdf_size_input', 'UploadCreate', upload, True)
case('oversized_upload', 'UploadCreate', {**upload,'size_bytes':2147483649}, False)
case('profile_snapshot_shape', 'MetricInput', metric, True)
case('missing_value_with_reason', 'MetricInput', {**metric,'value':None,'missing_reason':'not_provided'}, True)
case('missing_value_without_reason', 'MetricInput', {**metric,'value':None}, False)
case('decimal_number_rejected', 'MetricInput', {**metric,'value':631}, False)
case('snapshot_missing_timestamp', 'MetricInput', {k:v for k,v in metric.items() if k!='observed_at'}, False)
case('invalid_date', 'MetricInput', {**metric,'observed_at':'yesterday'}, False)
case('graphic_revision', 'ContentRevisionInput', revision, True)
case('graphic_missing_pages', 'ContentRevisionInput', {k:v for k,v in revision.items() if k!='pages'}, False)
case('conflicting_media_payload', 'ContentRevisionInput', {**revision,'shots':[]}, False)
case('manual_batch', 'ImportCreate', manual, True)
case('empty_manual_batch', 'ImportCreate', {**manual,'manual_rows':[]}, False)
case('file_batch_without_files', 'ImportCreate', {**manual,'source_type':'csv'}, False)
case('approve_review_shape', 'ReviewDecision', review, True)
case('reject_without_reason', 'ReviewDecision', {**review,'decision':'reject','comment':''}, False)
case('report_with_calculation_reference', 'ReportPayload', report, True)
bad=copy.deepcopy(report);del bad['facts'][0]['calculation_id']
case('report_without_calculation_reference', 'ReportPayload', bad, False)
case('campaign_draw_without_record', 'DrawCampaign', {'actual_drawn_at':t,'expected_version':1}, False)
case('publication_edit_without_revision', 'PublicationChangeCreate', {'kind':'edited','evidence':'测试','occurred_at':t,'expected_version':1}, False)
case('reminder_external_channel_rejected', 'ReminderRuleInput', {'offset_seconds':0,'enabled':True,'channel':'email','recipient_ids':[id]}, False)
results=[]
for label,name,payload,accepted in cases:
    errors=validate(name,payload)
    passed=(not errors)==accepted
    results.append({'case':label,'schema':name,'expected_accept':accepted,'passed':passed})
    assert passed, (label,[e.message for e in errors])
result={'validation_kind':'contract_and_synthetic_schema_fixtures','checked_at':datetime.now(timezone.utc).isoformat(),'openapi':'PASS','json_schema':'PASS','paths':len(spec['paths']),'operations':len(operation_ids),'schemas':len(domain['$defs']),'fixture_count':len(results),'fixtures':results,'runtime_api_tests':'NOT_RUN','database_state_guards':'NOT_RUN','external_source_tests':'see_source_probes_not_this_report'}
(root/'docs/evidence/s0/contract-validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(f"PASS: OpenAPI 3.1 + JSON Schema 2020-12; {len(operation_ids)} operations; {len(results)} schema fixtures. Runtime not tested.")
