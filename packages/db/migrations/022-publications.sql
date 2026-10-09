CREATE TABLE publication_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,content_id uuid NOT NULL,revision_id uuid NOT NULL,
 partial_fields jsonb NOT NULL,verification_note text NOT NULL,created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,content_id) REFERENCES contents(workspace_id,id),FOREIGN KEY(workspace_id,revision_id) REFERENCES content_revisions(workspace_id,id),FOREIGN KEY(workspace_id,created_by) REFERENCES memberships(workspace_id,id)
);
CREATE TABLE publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,account_id uuid NOT NULL,content_id uuid NOT NULL,
 revision_id uuid NOT NULL,current_revision_id uuid NOT NULL,platform_note_id text NOT NULL CHECK(length(platform_note_id)>0),url text NOT NULL,
 published_at timestamptz NOT NULL,recorded_by uuid NOT NULL,traffic_type text NOT NULL CHECK(traffic_type IN ('organic','paid','mixed','unknown')),is_campaign boolean NOT NULL,
 lifecycle text NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','deleted')),version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,id),UNIQUE(account_id,platform_note_id),UNIQUE(content_id),
 FOREIGN KEY(workspace_id,content_id) REFERENCES contents(workspace_id,id),FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,revision_id) REFERENCES content_revisions(workspace_id,id),FOREIGN KEY(workspace_id,current_revision_id) REFERENCES content_revisions(workspace_id,id),FOREIGN KEY(workspace_id,recorded_by) REFERENCES memberships(workspace_id,id)
);
CREATE FUNCTION publication_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (NEW.workspace_id,NEW.account_id,NEW.content_id,NEW.revision_id,NEW.platform_note_id,NEW.url,NEW.published_at,NEW.recorded_by,NEW.traffic_type,NEW.is_campaign) IS DISTINCT FROM (OLD.workspace_id,OLD.account_id,OLD.content_id,OLD.revision_id,OLD.platform_note_id,OLD.url,OLD.published_at,OLD.recorded_by,OLD.traffic_type,OLD.is_campaign) THEN RAISE EXCEPTION 'Initial publication cannot be rewritten'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_publication_identity BEFORE UPDATE OR DELETE ON publications FOR EACH ROW EXECUTE FUNCTION publication_identity_guard();
