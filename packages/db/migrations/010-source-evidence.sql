CREATE TABLE source_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,connection_id uuid NOT NULL,
 external_id text NOT NULL,canonical_url text NOT NULL,actual_source_type text NOT NULL,
 title text NOT NULL,summary text NOT NULL DEFAULT '',author text,published_at timestamptz,date_label_raw text,
 captured_at timestamptz NOT NULL,media_type text NOT NULL CHECK(media_type IN ('image','video','unknown')),
 visible_counts jsonb NOT NULL DEFAULT '{}',rank integer,keyword text,cluster_key text NOT NULL,
 reference_only boolean NOT NULL DEFAULT true CHECK(reference_only),content_hash text NOT NULL,
 availability text NOT NULL DEFAULT 'observed' CHECK(availability IN ('observed','unavailable','unknown')),
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),UNIQUE(connection_id,external_id),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES source_connections(workspace_id,id)
);
CREATE TABLE source_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,source_item_id uuid NOT NULL,run_id uuid NOT NULL,
 captured_at timestamptz NOT NULL,payload jsonb NOT NULL,content_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_item_id,run_id),FOREIGN KEY(workspace_id,source_item_id) REFERENCES source_items(workspace_id,id),
 FOREIGN KEY(workspace_id,run_id) REFERENCES collection_runs(workspace_id,id)
);
CREATE TRIGGER source_observation_immutable BEFORE UPDATE OR DELETE ON source_observations FOR EACH ROW EXECUTE FUNCTION s2_immutable();
CREATE INDEX source_items_feed ON source_items(workspace_id,captured_at DESC,id DESC);
CREATE INDEX source_items_cluster ON source_items(workspace_id,cluster_key);
