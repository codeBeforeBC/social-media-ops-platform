CREATE SCHEMA retired;
REVOKE ALL ON SCHEMA retired FROM PUBLIC;
-- Preserve original relationship values before detaching the retained entities.
CREATE TABLE retired.relationships AS
 SELECT 'publication'::text entity,id,to_jsonb(p) legacy FROM publications p
 UNION ALL SELECT 'topic',id,to_jsonb(t) FROM topics t
 UNION ALL SELECT 'topic_decision',id,to_jsonb(d) FROM topic_decisions d
 UNION ALL SELECT 'ai_request',id,to_jsonb(r) FROM ai_requests r;
CREATE TRIGGER retired_relationships_immutable BEFORE INSERT OR UPDATE OR DELETE ON retired.relationships FOR EACH ROW EXECUTE FUNCTION s2_immutable();
ALTER TABLE publications DROP COLUMN content_id, DROP COLUMN revision_id, DROP COLUMN current_revision_id, DROP COLUMN is_campaign;
ALTER TABLE topics DROP COLUMN accepted_content_id, DROP COLUMN accepted_revision_id, DROP COLUMN brief_job_id, DROP COLUMN accepted_media_type;
ALTER TABLE topic_decisions DROP COLUMN content_id;
ALTER TABLE ai_requests DROP COLUMN result_revision_id;
CREATE FUNCTION yoyo_job_supported(job_type text,job_pool text,job_input jsonb) RETURNS boolean LANGUAGE sql AS $$
 SELECT job_pool IN ('general','media') AND
 job_type !~ '^(content\.|brief\.|asset\.|guideline\.|media\.preview$|calendar[._]|campaign[._]|schedule[._]|reminder[._]|publication\.recorded$)' AND
 (job_type<>'ai.generate' OR EXISTS(SELECT 1 FROM public.ai_requests r WHERE r.id::text=job_input->>'ai_request_id' AND r.kind='topics' AND r.snapshot->>'scope_version'='v1.2'))
$$;
ALTER TABLE outbox ADD COLUMN retired_at timestamptz;
ALTER TABLE outbox ADD COLUMN retirement_reason text;
UPDATE outbox SET retired_at=now(),retirement_reason='CHANGE-007/008 scope v1.2',dispatched_at=COALESCE(dispatched_at,now())
 WHERE NOT yoyo_job_supported(event_type,COALESCE(payload->>'pool','general'),COALESCE(payload->'input','{}'));
INSERT INTO audit_logs(workspace_id,actor_type,action,object_type,object_id,details,request_id)
 SELECT workspace_id,'service','scope.retire_job','job',id,jsonb_build_object('reason','CHANGE-007/008','previous_state',state,'type',type,'pool',pool),request_id FROM jobs WHERE NOT yoyo_job_supported(type,pool,input) AND state IN ('queued','running');
UPDATE jobs SET state='cancelled',cancel_requested=true,error_code='SCOPE_RETIRED',lease_token=NULL,lease_until=NULL,finished_at=now(),version=version+1 WHERE NOT yoyo_job_supported(type,pool,input) AND state IN ('queued','running');
UPDATE ai_requests SET state='cancelled',error_code='SCOPE_RETIRED',finished_at=now() WHERE state IN ('queued','running') AND (kind<>'topics' OR snapshot->>'scope_version' IS DISTINCT FROM 'v1.2');
UPDATE notifications SET superseded_at=COALESCE(superseded_at,now()),task_ref=NULL WHERE task_ref ~ '^(content|asset|review|export|calendar|campaign|publication):' OR event_key ~ '^(publication|calendar|campaign|reminder|content|asset)[.:]' OR job_id IN (SELECT id FROM jobs WHERE NOT yoyo_job_supported(type,pool,input));
-- Keep old responses and cache for audit; v1.2 uses a new idempotency and AI version namespace.
CREATE TABLE retired.idempotency_records AS SELECT * FROM idempotency_records;
CREATE TABLE retired.ai_runs AS SELECT * FROM ai_runs;
INSERT INTO audit_logs(workspace_id,actor_type,action,object_type,object_id,details,request_id)
 SELECT workspace_id,'service','membership.retire_reviewer','membership',id,jsonb_build_object('previous_roles',roles),gen_random_uuid() FROM memberships WHERE 'reviewer'=ANY(roles);
UPDATE memberships SET roles=ARRAY(SELECT DISTINCT CASE WHEN r='reviewer' THEN 'viewer' ELSE r END FROM unnest(roles) r ORDER BY 1),version=version+1,updated_at=now() WHERE 'reviewer'=ANY(roles);
ALTER TABLE memberships DROP CONSTRAINT memberships_roles_check;
ALTER TABLE memberships ADD CHECK(cardinality(roles)>0 AND roles <@ ARRAY['admin','editor','operator','viewer']::text[]);
ALTER TABLE jobs DROP CONSTRAINT jobs_pool_check;
ALTER TABLE jobs ADD CHECK(pool IN ('general','media') OR (pool='reminder' AND state NOT IN ('queued','running')));
CREATE FUNCTION scope_job_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT yoyo_job_supported(NEW.type,NEW.pool,NEW.input) AND (TG_OP='INSERT' OR NEW.state IN ('queued','running','succeeded','partial')) THEN RAISE EXCEPTION 'SCOPE_RETIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scope_job_guard BEFORE INSERT OR UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION scope_job_guard();
CREATE FUNCTION scope_outbox_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT yoyo_job_supported(NEW.event_type,COALESCE(NEW.payload->>'pool','general'),COALESCE(NEW.payload->'input','{}')) THEN RAISE EXCEPTION 'SCOPE_RETIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scope_outbox_guard BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION scope_outbox_guard();
CREATE FUNCTION scope_ai_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.kind<>'topics' OR NEW.snapshot->>'scope_version' IS DISTINCT FROM 'v1.2') AND (TG_OP='INSERT' OR NEW.state IN ('queued','running','succeeded')) THEN RAISE EXCEPTION 'SCOPE_RETIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scope_ai_guard BEFORE INSERT OR UPDATE ON ai_requests FOR EACH ROW EXECUTE FUNCTION scope_ai_guard();
CREATE FUNCTION scope_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.purpose NOT IN ('import_screenshot','import_table','source_evidence') OR NEW.purpose IS NULL OR NEW.account_id IS NULL THEN RAISE EXCEPTION 'SCOPE_RETIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scope_file_guard BEFORE INSERT OR UPDATE ON file_objects FOR EACH ROW EXECUTE FUNCTION scope_file_guard();
CREATE TRIGGER scope_upload_guard BEFORE INSERT OR UPDATE ON upload_sessions FOR EACH ROW EXECUTE FUNCTION scope_file_guard();
-- Retain all historical tables and foreign keys, but stop exposing them in the public schema.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['folders','assets','asset_versions','asset_favorites','asset_relations','asset_usages','brand_rules','rule_sets','operational_proposals','contents','content_revisions','media_deliverables','reviews','export_packages','publication_drafts','publication_changes'] LOOP
  EXECUTE format('ALTER TABLE public.%I SET SCHEMA retired',t);
  EXECUTE format('CREATE TRIGGER scope_retired_write BEFORE INSERT OR UPDATE OR DELETE ON retired.%I FOR EACH ROW EXECUTE FUNCTION public.s2_immutable()',t);
 END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA retired FROM PUBLIC;
