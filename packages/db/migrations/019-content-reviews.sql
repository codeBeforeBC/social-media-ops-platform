ALTER TABLE contents ADD COLUMN approved_revision_id uuid;
ALTER TABLE contents ADD FOREIGN KEY(workspace_id,approved_revision_id) REFERENCES content_revisions(workspace_id,id);
CREATE TABLE reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,content_id uuid NOT NULL,revision_id uuid NOT NULL,
 payload_hash text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn','stale')),
 requester_id uuid NOT NULL,reviewer_id uuid,checklist jsonb NOT NULL DEFAULT '[]',comment text NOT NULL DEFAULT '',decided_at timestamptz,
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,content_id) REFERENCES contents(workspace_id,id),
 FOREIGN KEY(workspace_id,revision_id) REFERENCES content_revisions(workspace_id,id),
 FOREIGN KEY(workspace_id,requester_id) REFERENCES memberships(workspace_id,id),FOREIGN KEY(workspace_id,reviewer_id) REFERENCES memberships(workspace_id,id)
);
CREATE UNIQUE INDEX one_pending_review ON reviews(content_id) WHERE status='pending';
CREATE FUNCTION review_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'pending' OR NEW.revision_id<>OLD.revision_id OR NEW.content_id<>OLD.content_id OR NEW.payload_hash<>OLD.payload_hash OR NEW.requester_id<>OLD.requester_id THEN RAISE EXCEPTION 'Review history cannot be rewritten'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_review_history BEFORE UPDATE OR DELETE ON reviews FOR EACH ROW EXECUTE FUNCTION review_history_guard();
