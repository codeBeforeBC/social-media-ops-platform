ALTER TABLE reports ADD COLUMN window_start timestamptz,ADD COLUMN window_end timestamptz,
 ADD COLUMN created_by uuid,ADD COLUMN job_id uuid,ADD COLUMN ai_run_id uuid,
 ADD COLUMN state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed','cancelled')),
 ADD COLUMN snapshot jsonb NOT NULL DEFAULT '{}',ADD COLUMN result jsonb,ADD COLUMN error_code text;
ALTER TABLE reports ADD CHECK(window_start IS NULL OR window_start<window_end),
 ADD FOREIGN KEY(workspace_id,created_by) REFERENCES memberships(workspace_id,id),
 ADD FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id),
 ADD FOREIGN KEY(workspace_id,ai_run_id) REFERENCES ai_runs(workspace_id,id);
CREATE INDEX report_history ON reports(workspace_id,account_id,created_at DESC,id DESC);
CREATE TABLE strategy_memories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,account_id uuid NOT NULL,
 report_id uuid NOT NULL,action_index int NOT NULL CHECK(action_index>=0),action jsonb NOT NULL,
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','active','retired')),
 created_by uuid NOT NULL,activated_by uuid,activated_at timestamptz,retired_reason text,
 review_at timestamptz NOT NULL,version int NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),UNIQUE(report_id,action_index),
 FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id),FOREIGN KEY(workspace_id,report_id) REFERENCES reports(workspace_id,id),
 FOREIGN KEY(workspace_id,created_by) REFERENCES memberships(workspace_id,id),FOREIGN KEY(workspace_id,activated_by) REFERENCES memberships(workspace_id,id)
);
CREATE FUNCTION s8_report_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.snapshot<>'{}' AND (NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.account_id<>OLD.account_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.window_start IS DISTINCT FROM OLD.window_start OR NEW.window_end IS DISTINCT FROM OLD.window_end OR OLD.result IS NOT NULL AND NEW.result IS DISTINCT FROM OLD.result) THEN RAISE EXCEPTION 'report facts are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER s8_report_history BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION s8_report_history_guard();
CREATE FUNCTION s8_report_retire_strategies() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='stale' THEN UPDATE strategy_memories SET status='retired',retired_reason='报告数据已失效，需重新复盘确认',version=version+1,updated_at=now() WHERE report_id=NEW.id AND status<>'retired'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER s8_report_strategies AFTER UPDATE OF status ON reports FOR EACH ROW EXECUTE FUNCTION s8_report_retire_strategies();
CREATE FUNCTION s8_report_new_observation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Missing-data reports also depend on the absence of observations, including period-end snapshots.
 UPDATE reports SET status='stale',version=version+1,updated_at=now() WHERE workspace_id=NEW.workspace_id AND account_id=NEW.account_id AND status<>'stale' AND window_start IS NOT NULL
 AND (snapshot->'filters'->>'publication_id' IS NULL OR snapshot->'filters'->>'publication_id'=NEW.publication_id::text)
 AND (snapshot->'filters'->>'traffic_type' IS NULL OR snapshot->'filters'->>'traffic_type'=NEW.metric->>'traffic_type')
 AND (snapshot->'filters'->>'media_type' IS NULL OR EXISTS(SELECT 1 FROM publications p WHERE p.id=NEW.publication_id AND p.media_type=snapshot->'filters'->>'media_type'))
 AND (CASE WHEN NEW.metric->>'aggregation_kind'='interval' THEN (NEW.metric->>'window_start')::timestamptz>=window_start AND (NEW.metric->>'window_end')::timestamptz<=window_end ELSE (NEW.metric->>'observed_at')::timestamptz BETWEEN window_start AND window_end END);
 RETURN NEW;
END $$;
CREATE TRIGGER s8_new_observation AFTER INSERT ON metric_observations FOR EACH ROW EXECUTE FUNCTION s8_report_new_observation();
CREATE FUNCTION s8_report_job_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.type='report.generate' THEN UPDATE reports SET state=NEW.state,error_code=NEW.error_code,job_id=NEW.id,updated_at=now() WHERE id::text=NEW.input->>'report_id' AND workspace_id=NEW.workspace_id AND NEW.state IN ('queued','running','failed','cancelled'); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER s8_report_job AFTER INSERT OR UPDATE OF state ON jobs FOR EACH ROW EXECUTE FUNCTION s8_report_job_state();
