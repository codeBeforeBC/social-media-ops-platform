CREATE TABLE folders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),created_by uuid NOT NULL REFERENCES memberships(id),
 name text NOT NULL,parent_id uuid,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,parent_id) REFERENCES folders(workspace_id,id),CHECK(id<>parent_id)
);
CREATE TABLE assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),created_by uuid NOT NULL REFERENCES memberships(id),
 name text NOT NULL,category text NOT NULL CHECK(category IN ('guideline','2d','3d_source','render','video','audio')),ip_identity text NOT NULL,
 folder_id uuid,owner_id uuid NOT NULL,source text NOT NULL,series text NOT NULL DEFAULT '',tags text[] NOT NULL DEFAULT '{}',
 business_status text NOT NULL DEFAULT 'pending_confirmation' CHECK(business_status IN ('pending_confirmation','usable','retired')),
 current_version_id uuid,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,folder_id) REFERENCES folders(workspace_id,id),FOREIGN KEY(workspace_id,owner_id) REFERENCES memberships(workspace_id,id)
);
CREATE TABLE asset_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES memberships(id),asset_id uuid NOT NULL,
 version_no integer NOT NULL CHECK(version_no>0),source_file_id uuid NOT NULL,preview_file_id uuid,parent_version_id uuid,
 usage_scope text NOT NULL DEFAULT '',valid_until timestamptz,software text,dependencies uuid[] NOT NULL DEFAULT '{}',
 permission_confirmed_by uuid,permission_confirmed_at timestamptz,checklist text[] NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),UNIQUE(asset_id,version_no),FOREIGN KEY(workspace_id,asset_id) REFERENCES assets(workspace_id,id),
 FOREIGN KEY(workspace_id,source_file_id) REFERENCES file_objects(workspace_id,id),FOREIGN KEY(workspace_id,preview_file_id) REFERENCES file_objects(workspace_id,id),
 FOREIGN KEY(workspace_id,parent_version_id) REFERENCES asset_versions(workspace_id,id),FOREIGN KEY(workspace_id,permission_confirmed_by) REFERENCES memberships(workspace_id,id)
);
ALTER TABLE assets ADD FOREIGN KEY(workspace_id,current_version_id) REFERENCES asset_versions(workspace_id,id);
CREATE TABLE asset_favorites (
 workspace_id uuid NOT NULL,asset_id uuid NOT NULL,membership_id uuid NOT NULL,
 PRIMARY KEY(asset_id,membership_id),FOREIGN KEY(workspace_id,asset_id) REFERENCES assets(workspace_id,id),FOREIGN KEY(workspace_id,membership_id) REFERENCES memberships(workspace_id,id)
);
CREATE TABLE asset_relations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES memberships(id),
 from_version_id uuid NOT NULL,to_version_id uuid NOT NULL,relation_type text NOT NULL CHECK(relation_type IN ('source_of','render_of','derived_from')),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(from_version_id,to_version_id,relation_type),
 FOREIGN KEY(workspace_id,from_version_id) REFERENCES asset_versions(workspace_id,id),FOREIGN KEY(workspace_id,to_version_id) REFERENCES asset_versions(workspace_id,id),CHECK(from_version_id<>to_version_id)
);
-- S2 reference foundation; S4 extends production fields/workflow. No production rows are created by S2.
CREATE TABLE contents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,account_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES memberships(id),
 title text NOT NULL DEFAULT '',business_status text NOT NULL DEFAULT 'draft' CHECK(business_status IN ('draft','in_production','in_review','ready_to_publish','published','cancelled')),
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id)
);
CREATE TABLE content_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,content_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES memberships(id),
 revision_no integer NOT NULL CHECK(revision_no>0),frozen boolean NOT NULL DEFAULT false,payload jsonb NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),UNIQUE(content_id,revision_no),FOREIGN KEY(workspace_id,content_id) REFERENCES contents(workspace_id,id)
);
CREATE TABLE asset_usages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES memberships(id),
 asset_version_id uuid NOT NULL,revision_id uuid NOT NULL,usage_role text NOT NULL,clip_start_ms integer,clip_end_ms integer,
 permission_snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(asset_version_id,revision_id,usage_role),FOREIGN KEY(workspace_id,asset_version_id) REFERENCES asset_versions(workspace_id,id),
 FOREIGN KEY(workspace_id,revision_id) REFERENCES content_revisions(workspace_id,id),CHECK(clip_start_ms>=0 AND clip_end_ms>clip_start_ms)
);
CREATE TABLE rule_sets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES memberships(id),
 edition text NOT NULL,source_file_id uuid NOT NULL,status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','retired')),
 activated_by uuid,activated_at timestamptz,checklist text[] NOT NULL DEFAULT '{}',version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,source_file_id) REFERENCES file_objects(workspace_id,id),FOREIGN KEY(workspace_id,activated_by) REFERENCES memberships(workspace_id,id)
);
CREATE UNIQUE INDEX one_active_rules ON rule_sets(workspace_id) WHERE status='active';
CREATE TABLE brand_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,rule_set_id uuid NOT NULL,category text NOT NULL,rule_text text NOT NULL,
 source_page integer NOT NULL CHECK(source_page>0),severity text NOT NULL,uncertainty_note text,
 FOREIGN KEY(workspace_id,rule_set_id) REFERENCES rule_sets(workspace_id,id)
);
CREATE TABLE operational_proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),created_by uuid NOT NULL REFERENCES memberships(id),
 proposal text NOT NULL,status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','active','retired')),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION s2_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable version/reference record'; END $$;
CREATE TRIGGER immutable_asset_version BEFORE UPDATE OR DELETE ON asset_versions FOR EACH ROW EXECUTE FUNCTION s2_immutable();
CREATE TRIGGER immutable_asset_usage BEFORE UPDATE OR DELETE ON asset_usages FOR EACH ROW EXECUTE FUNCTION s2_immutable();
CREATE INDEX asset_search_filter ON assets(workspace_id,category,created_at DESC,id DESC);
CREATE INDEX usage_revision ON asset_usages(workspace_id,revision_id);
