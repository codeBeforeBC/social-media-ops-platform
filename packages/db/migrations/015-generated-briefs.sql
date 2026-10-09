ALTER TABLE content_revisions ADD COLUMN origin text NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual','ai_candidate','applied_ai'));
ALTER TABLE content_revisions ADD COLUMN base_revision_id uuid;
ALTER TABLE content_revisions ADD FOREIGN KEY(workspace_id,base_revision_id) REFERENCES content_revisions(workspace_id,id);
ALTER TABLE content_revisions ADD COLUMN ai_request_id uuid;
ALTER TABLE content_revisions ADD FOREIGN KEY(workspace_id,ai_request_id) REFERENCES ai_requests(workspace_id,id);
ALTER TABLE content_revisions ADD COLUMN payload_hash text;
ALTER TABLE content_revisions ADD COLUMN source_revision_id uuid;
ALTER TABLE content_revisions ADD FOREIGN KEY(workspace_id,source_revision_id) REFERENCES content_revisions(workspace_id,id);
CREATE UNIQUE INDEX single_candidate_per_request ON content_revisions(ai_request_id) WHERE origin='ai_candidate';
CREATE UNIQUE INDEX single_candidate_application ON content_revisions(source_revision_id) WHERE origin='applied_ai';
ALTER TABLE ai_requests ADD COLUMN result_revision_id uuid;
ALTER TABLE ai_requests ADD FOREIGN KEY(workspace_id,result_revision_id) REFERENCES content_revisions(workspace_id,id);
CREATE FUNCTION frozen_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.frozen AND (TG_OP='DELETE' OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.frozen IS DISTINCT FROM OLD.frozen OR NEW.origin IS DISTINCT FROM OLD.origin OR NEW.content_id IS DISTINCT FROM OLD.content_id OR NEW.base_revision_id IS DISTINCT FROM OLD.base_revision_id OR NEW.ai_request_id IS DISTINCT FROM OLD.ai_request_id OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash) THEN RAISE EXCEPTION 'Frozen revision cannot be rewritten'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER protect_frozen_revision BEFORE UPDATE OR DELETE ON content_revisions FOR EACH ROW EXECUTE FUNCTION frozen_revision_guard();
