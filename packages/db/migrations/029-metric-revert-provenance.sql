-- Minimal report persistence for dependency invalidation only; report generation belongs to S8.
CREATE TABLE reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,account_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('draft','partial','final','stale')),version int NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id)
);
CREATE TABLE report_observations (
 workspace_id uuid NOT NULL, report_id uuid NOT NULL, observation_id uuid NOT NULL,
 PRIMARY KEY(report_id,observation_id), FOREIGN KEY(workspace_id,report_id) REFERENCES reports(workspace_id,id),
 FOREIGN KEY(workspace_id,observation_id) REFERENCES metric_observations(workspace_id,id)
);
CREATE TABLE report_invalidations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,report_id uuid NOT NULL,
 observation_id uuid NOT NULL,reason text NOT NULL,request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,report_id) REFERENCES reports(workspace_id,id),FOREIGN KEY(workspace_id,observation_id) REFERENCES metric_observations(workspace_id,id)
);
CREATE TABLE import_reversions (
 batch_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,actor_id uuid NOT NULL,reason text NOT NULL CHECK(length(trim(reason))>0),
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(workspace_id,batch_id) REFERENCES import_batches(workspace_id,id),FOREIGN KEY(workspace_id,actor_id) REFERENCES memberships(workspace_id,id)
);
CREATE FUNCTION metric_invalidate_reports(scope uuid,observations uuid[],why text,request uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO report_invalidations(workspace_id,report_id,observation_id,reason,request_id)
 SELECT workspace_id,report_id,observation_id,why,request FROM report_observations WHERE workspace_id=scope AND observation_id=ANY(observations);
 UPDATE reports SET status='stale',version=version+1,updated_at=now() WHERE workspace_id=scope AND id IN (SELECT report_id FROM report_observations WHERE workspace_id=scope AND observation_id=ANY(observations));
END $$;
