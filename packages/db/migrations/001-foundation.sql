CREATE TABLE workspaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(200) NOT NULL,
 timezone text NOT NULL DEFAULT 'Asia/Shanghai', settings jsonb NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE CHECK(email=lower(email)),
 display_name varchar(200) NOT NULL, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),user_id uuid NOT NULL REFERENCES users(id),
 roles text[] NOT NULL CHECK(cardinality(roles)>0 AND roles <@ ARRAY['admin','editor','reviewer','operator','viewer']::text[]),
 active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,user_id), UNIQUE(workspace_id,id)
);
CREATE TABLE accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id), platform text NOT NULL,
 platform_user_id text NOT NULL,display_handle text NOT NULL DEFAULT '',name varchar(200) NOT NULL,profile_url text,
 owner_id uuid NOT NULL,timezone text NOT NULL DEFAULT 'Asia/Shanghai',version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,owner_id) REFERENCES memberships(workspace_id,id),
 UNIQUE(workspace_id,platform,platform_user_id),UNIQUE(workspace_id,id)
);
CREATE TABLE account_memberships (
 workspace_id uuid NOT NULL, account_id uuid NOT NULL,membership_id uuid NOT NULL,
 PRIMARY KEY(account_id,membership_id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,membership_id) REFERENCES memberships(workspace_id,id)
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY,csrf_hash text NOT NULL,user_id uuid REFERENCES users(id),workspace_id uuid REFERENCES workspaces(id),
 expires_at timestamptz NOT NULL,last_seen_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((user_id IS NULL)=(workspace_id IS NULL))
);
CREATE TABLE instance_state (id integer PRIMARY KEY CHECK(id=1),initialized_at timestamptz);
INSERT INTO instance_state(id) VALUES(1);
CREATE TABLE login_limits (key text PRIMARY KEY,attempts integer NOT NULL DEFAULT 0,reset_at timestamptz NOT NULL);
CREATE TABLE idempotency_records (
 workspace_id uuid NOT NULL, actor_id uuid NOT NULL,method text NOT NULL,route text NOT NULL,key text NOT NULL,
 request_hash text NOT NULL,status integer NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,actor_id,method,route,key),
 FOREIGN KEY(workspace_id,actor_id) REFERENCES memberships(workspace_id,id)
);
CREATE TABLE outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),account_id uuid,
 event_key text NOT NULL,event_type text NOT NULL,payload jsonb NOT NULL,available_at timestamptz NOT NULL DEFAULT now(),
 dispatched_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,event_key),UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id)
);
CREATE TABLE jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),account_id uuid,created_by uuid NOT NULL,
 outbox_id uuid,type text NOT NULL,pool text NOT NULL CHECK(pool IN ('general','reminder','media')),input jsonb NOT NULL DEFAULT '{}',
 input_version integer, state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','partial','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0,max_attempts integer NOT NULL DEFAULT 3 CHECK(max_attempts>0),
 available_at timestamptz NOT NULL DEFAULT now(),lease_token uuid,lease_until timestamptz,heartbeat_at timestamptz,
 cancel_requested boolean NOT NULL DEFAULT false,timeout_seconds integer NOT NULL DEFAULT 120 CHECK(timeout_seconds>0),
 started_at timestamptz,finished_at timestamptz,result jsonb,error_code text,request_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(outbox_id),UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,outbox_id) REFERENCES outbox(workspace_id,id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,created_by) REFERENCES memberships(workspace_id,id)
);
CREATE INDEX jobs_claim ON jobs(pool,available_at) WHERE state IN ('queued','running');
CREATE TABLE notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),recipient_id uuid NOT NULL,
 event_key text NOT NULL,job_id uuid,channel text NOT NULL DEFAULT 'in_app' CHECK(channel='in_app'),title varchar(200) NOT NULL,
 task_ref text,read_at timestamptz,superseded_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,event_key,recipient_id,channel),
 FOREIGN KEY(workspace_id,recipient_id) REFERENCES memberships(workspace_id,id),FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id)
);
CREATE TABLE audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),actor_id uuid,
 actor_type text NOT NULL,action text NOT NULL,object_type text NOT NULL,object_id uuid,
 details jsonb NOT NULL DEFAULT '{}',request_id uuid NOT NULL,occurred_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,actor_id) REFERENCES memberships(workspace_id,id)
);
CREATE INDEX audit_pagination ON audit_logs(workspace_id,occurred_at DESC,id DESC);
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit logs are append-only'; END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TABLE process_health (name text PRIMARY KEY,pool text NOT NULL,last_seen_at timestamptz NOT NULL DEFAULT now());
