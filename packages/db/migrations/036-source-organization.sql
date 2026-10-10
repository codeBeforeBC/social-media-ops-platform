CREATE TABLE source_organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,account_id uuid NOT NULL,created_by uuid NOT NULL,
 snapshot jsonb NOT NULL,result jsonb,job_id uuid,ai_run_id uuid,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed','cancelled')),
 error_code text,accepted_group_indexes int[] NOT NULL DEFAULT '{}',reviewed_by uuid,reviewed_at timestamptz,
 version int NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id),FOREIGN KEY(workspace_id,created_by) REFERENCES memberships(workspace_id,id),FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id),FOREIGN KEY(workspace_id,ai_run_id) REFERENCES ai_runs(workspace_id,id),FOREIGN KEY(workspace_id,reviewed_by) REFERENCES memberships(workspace_id,id)
);
CREATE INDEX source_organization_history ON source_organizations(workspace_id,account_id,created_at DESC,id DESC);
CREATE FUNCTION source_organization_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD.id,OLD.workspace_id,OLD.account_id,OLD.snapshot) IS DISTINCT FROM (NEW.id,NEW.workspace_id,NEW.account_id,NEW.snapshot) OR OLD.result IS NOT NULL AND NEW.result IS DISTINCT FROM OLD.result THEN RAISE EXCEPTION 'source organization evidence immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER source_organization_immutable BEFORE UPDATE ON source_organizations FOR EACH ROW EXECUTE FUNCTION source_organization_guard();
CREATE FUNCTION source_organization_job_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.type='source.organize' AND NEW.state IN ('queued','running','failed','cancelled') THEN UPDATE source_organizations SET state=NEW.state,error_code=NEW.error_code,job_id=NEW.id,updated_at=now() WHERE workspace_id=NEW.workspace_id AND id::text=NEW.input->>'organization_id'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER source_organization_job AFTER INSERT OR UPDATE OF state ON jobs FOR EACH ROW EXECUTE FUNCTION source_organization_job_state();
