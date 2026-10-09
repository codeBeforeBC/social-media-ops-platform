CREATE TABLE ai_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,account_id uuid NOT NULL,created_by uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('topics','graphic','video')),input_version text NOT NULL,snapshot jsonb NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed','cancelled')),
 job_id uuid,ai_run_id uuid,result jsonb,error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,created_by) REFERENCES memberships(workspace_id,id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id),FOREIGN KEY(workspace_id,ai_run_id) REFERENCES ai_runs(workspace_id,id)
);
CREATE INDEX ai_request_history ON ai_requests(workspace_id,account_id,created_at DESC);
