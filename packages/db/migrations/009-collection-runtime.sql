CREATE TABLE source_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 created_by uuid NOT NULL, owner_id uuid NOT NULL,
 platform text NOT NULL CHECK(platform IN ('weibo','xiaohongshu')),
 source_type text NOT NULL CHECK(source_type IN ('weibo_hot','xhs_topic_signal','xhs_quality_note')),
 provider text NOT NULL CHECK(provider IN ('weibo_web','opencli')),
 name text NOT NULL, config jsonb NOT NULL DEFAULT '{}',
 capabilities jsonb NOT NULL DEFAULT '{"list_items":null,"read_detail":null,"read_comments":false,"historical_metrics":false,"own_account_metrics":false}',
 schedule text[] NOT NULL DEFAULT ARRAY['09:00','16:00'], timezone text NOT NULL DEFAULT 'Asia/Shanghai',
 enabled boolean NOT NULL DEFAULT false, paused boolean NOT NULL DEFAULT false,
 health text NOT NULL DEFAULT 'unverified' CHECK(health IN ('unverified','healthy','degraded','auth_required','rate_limited','unavailable','disabled')),
 consecutive_failures integer NOT NULL DEFAULT 0, min_interval_seconds integer NOT NULL DEFAULT 1800 CHECK(min_interval_seconds>=60),
 last_attempt_at timestamptz, last_success_at timestamptz, error_code text,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,created_by) REFERENCES memberships(workspace_id,id),
 FOREIGN KEY(workspace_id,owner_id) REFERENCES memberships(workspace_id,id)
);
CREATE TABLE collection_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, connection_id uuid NOT NULL,
 created_by uuid NOT NULL, job_id uuid, connection_version integer NOT NULL,
 trigger text NOT NULL CHECK(trigger IN ('manual','scheduled','verify')), scheduled_slot text,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','partial','failed','cancelled')),
 item_count integer NOT NULL DEFAULT 0, error_code text, coverage jsonb NOT NULL DEFAULT '{}',
 warnings text[] NOT NULL DEFAULT '{}', adapter_version text,
 started_at timestamptz, finished_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id), UNIQUE(connection_id,scheduled_slot),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES source_connections(workspace_id,id),
 FOREIGN KEY(workspace_id,created_by) REFERENCES memberships(workspace_id,id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id)
);
CREATE UNIQUE INDEX collection_single_active ON collection_runs(connection_id) WHERE state IN ('queued','running');
CREATE INDEX collection_history ON collection_runs(workspace_id,created_at DESC,id DESC);
