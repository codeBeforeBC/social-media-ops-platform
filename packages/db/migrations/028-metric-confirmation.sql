CREATE TABLE metric_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, account_id uuid NOT NULL,
 publication_id uuid, logical_key text NOT NULL, revision int NOT NULL, metric jsonb NOT NULL,
 value numeric(24,6), validity text NOT NULL CHECK(validity IN ('confirmed','superseded','reverted')),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id), UNIQUE(logical_key,revision), FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,publication_id) REFERENCES publications(workspace_id,id), FOREIGN KEY(workspace_id,created_by) REFERENCES memberships(workspace_id,id),
 CHECK((value IS NULL)=(metric->>'value' IS NULL))
);
CREATE UNIQUE INDEX metric_one_current ON metric_observations(logical_key) WHERE validity='confirmed';
CREATE INDEX metric_scope ON metric_observations(workspace_id,account_id,publication_id,created_at DESC,id DESC);
CREATE TABLE metric_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, batch_id uuid NOT NULL, row_id uuid NOT NULL UNIQUE,
 observation_id uuid NOT NULL, supports_value boolean NOT NULL, active boolean NOT NULL DEFAULT true,
 confirmed_by uuid NOT NULL, confirmed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,batch_id) REFERENCES import_batches(workspace_id,id), FOREIGN KEY(workspace_id,row_id) REFERENCES import_rows(workspace_id,id),
 FOREIGN KEY(workspace_id,observation_id) REFERENCES metric_observations(workspace_id,id), FOREIGN KEY(workspace_id,confirmed_by) REFERENCES memberships(workspace_id,id)
);
CREATE INDEX metric_evidence_observation ON metric_evidence(observation_id,active);
CREATE TABLE observation_supersessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, old_id uuid NOT NULL, new_id uuid NOT NULL,
 batch_id uuid NOT NULL, reason text NOT NULL CHECK(length(trim(reason))>0), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(old_id<>new_id), UNIQUE(batch_id,old_id,new_id),
 FOREIGN KEY(workspace_id,old_id) REFERENCES metric_observations(workspace_id,id), FOREIGN KEY(workspace_id,new_id) REFERENCES metric_observations(workspace_id,id), FOREIGN KEY(workspace_id,batch_id) REFERENCES import_batches(workspace_id,id)
);
CREATE FUNCTION metric_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'metric history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='metric_observations' AND (to_jsonb(OLD)-'validity')<>(to_jsonb(NEW)-'validity') THEN RAISE EXCEPTION 'metric observation is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME IN ('metric_evidence','observation_supersessions') AND (to_jsonb(OLD)-'active')<>(to_jsonb(NEW)-'active') THEN RAISE EXCEPTION 'metric evidence history is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER metric_observation_history BEFORE UPDATE OR DELETE ON metric_observations FOR EACH ROW EXECUTE FUNCTION metric_history_guard();
CREATE TRIGGER metric_evidence_history BEFORE UPDATE OR DELETE ON metric_evidence FOR EACH ROW EXECUTE FUNCTION metric_history_guard();
CREATE TRIGGER metric_supersession_history BEFORE UPDATE OR DELETE ON observation_supersessions FOR EACH ROW EXECUTE FUNCTION metric_history_guard();
