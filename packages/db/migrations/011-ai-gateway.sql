CREATE TABLE ai_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 created_by uuid NOT NULL, job_id uuid, workflow text NOT NULL, cache_key text NOT NULL,
 input_version text NOT NULL, input_hash text NOT NULL, input_refs jsonb NOT NULL,
 model text NOT NULL, provider text NOT NULL, prompt_version text NOT NULL, schema_version text NOT NULL,
 state text NOT NULL DEFAULT 'running' CHECK(state IN ('running','succeeded','failed','cancelled')),
 result jsonb, error_code text, validation jsonb NOT NULL DEFAULT '{}',
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,created_by) REFERENCES memberships(workspace_id,id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id)
);
CREATE UNIQUE INDEX ai_single_cached_run ON ai_runs(workspace_id,cache_key) WHERE state IN ('running','succeeded');
CREATE TABLE ai_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, run_id uuid NOT NULL,
 attempt integer NOT NULL CHECK(attempt IN (1,2)), state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','succeeded','failed')),
 budget_mode text NOT NULL, currency text, reserved_cost numeric(24,10), estimated_cost numeric(24,10),
 pricing_version text, usage jsonb, cost_basis text NOT NULL DEFAULT 'unknown', error_code text,
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, duration_ms integer,
 UNIQUE(run_id,attempt),FOREIGN KEY(workspace_id,run_id) REFERENCES ai_runs(workspace_id,id),
 CHECK(reserved_cost>=0 AND estimated_cost>=0)
);
CREATE INDEX ai_daily_budget ON ai_attempts(workspace_id,started_at);
