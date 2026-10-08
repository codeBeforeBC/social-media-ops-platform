CREATE TABLE upload_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 created_by uuid NOT NULL REFERENCES memberships(id), original_name text NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 2147483648), mime_hint text NOT NULL, purpose text NOT NULL,
 sha256 text CHECK(sha256 ~ '^[a-f0-9]{64}$'), part_size integer NOT NULL DEFAULT 8388608,
 object_key text NOT NULL UNIQUE, storage_upload_id text NOT NULL,
 status text NOT NULL DEFAULT 'created' CHECK(status IN ('created','uploading','completed','expired','aborted','failed')),
 parts jsonb NOT NULL DEFAULT '{}', file_id uuid, expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id)
);
CREATE TABLE file_objects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),
 created_by uuid NOT NULL REFERENCES memberships(id),upload_session_id uuid,
 object_key text NOT NULL UNIQUE,original_name text NOT NULL,size_bytes bigint NOT NULL CHECK(size_bytes>0),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),detected_mime text NOT NULL,
 file_status text NOT NULL DEFAULT 'ready' CHECK(file_status IN ('uploading','ready','failed','quarantined')),
 preview_status text NOT NULL DEFAULT 'not_requested' CHECK(preview_status IN ('not_requested','processing','ready','unsupported','failed')),
 preview_file_id uuid,metadata jsonb NOT NULL DEFAULT '{}',version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,sha256),
 FOREIGN KEY(workspace_id,upload_session_id) REFERENCES upload_sessions(workspace_id,id),
 FOREIGN KEY(workspace_id,preview_file_id) REFERENCES file_objects(workspace_id,id)
);
ALTER TABLE upload_sessions ADD FOREIGN KEY(workspace_id,file_id) REFERENCES file_objects(workspace_id,id);
CREATE INDEX upload_expiry ON upload_sessions(expires_at) WHERE status IN ('created','uploading');
