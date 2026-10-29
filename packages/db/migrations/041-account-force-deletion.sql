CREATE TABLE account_deletions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),account_id uuid NOT NULL,
 requested_by uuid NOT NULL,request_id uuid NOT NULL,job_id uuid,
 state text NOT NULL DEFAULT 'stopping' CHECK(state IN('stopping','backing_up','purging','cleaning_files','completed','failed')),
 phase text NOT NULL DEFAULT 'stopping',counts jsonb NOT NULL DEFAULT '{}',backup_key text,files jsonb NOT NULL DEFAULT '[]',
 error_code text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 UNIQUE(workspace_id,id),UNIQUE(account_id),FOREIGN KEY(workspace_id,requested_by) REFERENCES memberships(workspace_id,id),FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id)
);
ALTER TABLE accounts ADD COLUMN deletion_operation_id uuid REFERENCES account_deletions(id);
ALTER TABLE jobs ADD COLUMN execution_finished_at timestamptz;
UPDATE jobs SET execution_finished_at=finished_at WHERE state NOT IN('queued','running');
CREATE TABLE account_deleted_ai_usage(
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),deletion_id uuid NOT NULL REFERENCES account_deletions(id),
 started_at timestamptz NOT NULL,currency text,cost_basis text NOT NULL,estimated_cost numeric(24,10),reserved_cost numeric(24,10),usage jsonb
);
CREATE INDEX deleted_ai_daily_budget ON account_deleted_ai_usage(workspace_id,started_at);
CREATE TABLE account_owned_relations(schema_name text NOT NULL,table_name text NOT NULL,PRIMARY KEY(schema_name,table_name));
INSERT INTO account_owned_relations
WITH RECURSIVE owned(oid) AS (
 SELECT 'public.accounts'::regclass::oid UNION SELECT fk.conrelid FROM pg_constraint fk JOIN owned p ON p.oid=fk.confrelid
 JOIN pg_class c ON c.oid=fk.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE fk.contype='f' AND n.nspname IN('public','retired') AND c.relname NOT IN('account_deletions','account_deleted_ai_usage','audit_logs','idempotency_records')
) SELECT DISTINCT n.nspname,c.relname FROM owned JOIN pg_class c ON c.oid=owned.oid JOIN pg_namespace n ON n.oid=c.relnamespace;
CREATE FUNCTION account_row_owners(s text,t text,r jsonb,trail text[] DEFAULT '{}') RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE owners uuid[]:='{}';edge record;parent jsonb;predicate text;tag text:=s||'.'||t||':'||md5(r::text);got uuid[];
BEGIN
 IF t='accounts' AND s='public' THEN RETURN ARRAY[(r->>'id')::uuid];END IF;
 IF r->>'account_id' IS NOT NULL THEN RETURN ARRAY[(r->>'account_id')::uuid];END IF;
 IF tag=ANY(trail) OR cardinality(trail)>15 THEN RETURN owners;END IF;
 FOR edge IN SELECT pn.nspname ps,p.relname pt,array_agg(ca.attname::text ORDER BY k.ord) cs,array_agg(pa.attname::text ORDER BY k.ord) pc
 FROM pg_constraint fk JOIN pg_class c ON c.oid=fk.conrelid JOIN pg_namespace cn ON cn.oid=c.relnamespace
 JOIN pg_class p ON p.oid=fk.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace
 JOIN account_owned_relations ar ON ar.schema_name=pn.nspname AND ar.table_name=p.relname
 CROSS JOIN LATERAL unnest(fk.conkey,fk.confkey) WITH ORDINALITY k(cnum,pnum,ord)
 JOIN pg_attribute ca ON ca.attrelid=c.oid AND ca.attnum=k.cnum JOIN pg_attribute pa ON pa.attrelid=p.oid AND pa.attnum=k.pnum
 WHERE fk.contype='f' AND cn.nspname=s AND c.relname=t GROUP BY fk.oid,pn.nspname,p.relname LOOP
  predicate:='';FOR i IN 1..cardinality(edge.cs) LOOP
   IF r->>edge.cs[i] IS NULL THEN predicate:=NULL;EXIT;END IF;
   predicate:=predicate||CASE WHEN predicate='' THEN '' ELSE ' AND ' END||format('to_jsonb(p)->>%L=%L',edge.pc[i],r->>edge.cs[i]);
  END LOOP;
  IF predicate IS NULL THEN CONTINUE;END IF;
  FOR parent IN EXECUTE format('SELECT to_jsonb(p) FROM %I.%I p WHERE %s',edge.ps,edge.pt,predicate) LOOP
   got:=account_row_owners(edge.ps,edge.pt,parent,trail||tag);owners:=owners||got;
  END LOOP;
 END LOOP;
 RETURN ARRAY(SELECT DISTINCT unnest(owners));
END $$;
CREATE FUNCTION account_deletion_context() RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN RETURN NULLIF(current_setting('yoyo.account_deletion',true),'')::uuid;EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;END $$;
CREATE FUNCTION account_write_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner uuid;op uuid;context uuid:=account_deletion_context();
BEGIN
 IF TG_TABLE_NAME='accounts' AND TG_OP='INSERT' THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='jobs' AND TG_OP='UPDATE' AND (to_jsonb(NEW)-'execution_finished_at')=(to_jsonb(OLD)-'execution_finished_at') THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='ai_attempts' AND TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['usage','estimated_cost','cost_basis','state','finished_at','duration_ms','error_code'])=(to_jsonb(OLD)-ARRAY['usage','estimated_cost','cost_basis','state','finished_at','duration_ms','error_code']) THEN RETURN NEW;END IF;
 FOREACH owner IN ARRAY account_row_owners(TG_TABLE_SCHEMA,TG_TABLE_NAME,to_jsonb(NEW)) LOOP
  SELECT deletion_operation_id INTO op FROM accounts WHERE id=owner FOR SHARE;
  IF op IS NOT NULL AND (context IS NULL OR op<>context) THEN RAISE EXCEPTION 'ACCOUNT_DELETING' USING ERRCODE='55000';END IF;
 END LOOP;
 RETURN NEW;
END $$;
DO $$DECLARE r record;BEGIN
 FOR r IN SELECT * FROM account_owned_relations LOOP
  EXECUTE format('CREATE TRIGGER account_write_barrier BEFORE INSERT OR UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.account_write_barrier()',r.schema_name,r.table_name);
 END LOOP;
 -- Keep FK validation, but allow one purge transaction to resolve existing dependency cycles.
 FOR r IN SELECT n.nspname,c.relname,f.conname FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE f.contype='f' AND n.nspname IN('public','retired') AND NOT f.condeferrable AND f.confdeltype='a' LOOP
  EXECUTE format('ALTER TABLE %I.%I ALTER CONSTRAINT %I DEFERRABLE INITIALLY IMMEDIATE',r.nspname,r.relname,r.conname);
 END LOOP;
END $$;
CREATE FUNCTION account_purge_allowed(s text,t text,r jsonb) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE context uuid:=account_deletion_context();ok boolean;
BEGIN
 IF context IS NULL OR to_regclass('pg_temp.account_purge_rows') IS NULL THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM account_deletions d JOIN accounts a ON a.id=d.account_id AND a.workspace_id=d.workspace_id AND a.deletion_operation_id=d.id WHERE d.id=context AND d.state='purging') THEN RETURN false;END IF;
 EXECUTE 'SELECT EXISTS(SELECT 1 FROM pg_temp.account_purge_rows WHERE operation_id=$1 AND schema_name=$2 AND table_name=$3 AND $4 @> row_key)' INTO ok USING context,s,t,r;
 RETURN ok;
END $$;
-- Add a tightly scoped DELETE exception to the existing immutable guards. Normal edits stay unchanged.
DO $$DECLARE f record;definition text;BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN('s2_immutable','frozen_revision_guard','review_history_guard','publication_identity_guard','metric_history_guard','calculation_history_guard','account_verification_immutable','import_row_history_guard') LOOP
  definition:=pg_get_functiondef(f.oid);
  definition:=regexp_replace(definition,'\mBEGIN\M',E'BEGIN\n IF TG_OP=''DELETE'' AND public.account_purge_allowed(TG_TABLE_SCHEMA,TG_TABLE_NAME,to_jsonb(OLD)) THEN RETURN OLD; END IF;', 'i');
  EXECUTE definition;
 END LOOP;
END $$;
ALTER FUNCTION yoyo_job_supported(text,text,jsonb) RENAME TO yoyo_job_supported_pre_deletion;
CREATE FUNCTION yoyo_job_supported(job_type text,job_pool text,job_input jsonb) RETURNS boolean LANGUAGE sql AS $$
 SELECT public.yoyo_job_supported_pre_deletion(job_type,job_pool,job_input) AND
 (job_type<>'account.delete' OR (job_pool='general' AND COALESCE(job_input->>'deletion_id','') ~ '^[a-f0-9-]{36}$'))
$$;
