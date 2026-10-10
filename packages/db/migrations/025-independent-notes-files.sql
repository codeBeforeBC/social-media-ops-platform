-- Compatibility first: old identities remain intact while new registrations stop using production.
ALTER TABLE publications ADD COLUMN title text;
ALTER TABLE publications ADD COLUMN media_type text CHECK(media_type IN ('graphic','video'));
DROP TRIGGER protect_publication_identity ON publications;
UPDATE publications p SET title=NULLIF(c.title,''),media_type=c.media_type FROM contents c WHERE c.id=p.content_id;
ALTER TABLE publications ALTER COLUMN content_id DROP NOT NULL;
ALTER TABLE publications ALTER COLUMN revision_id DROP NOT NULL;
ALTER TABLE publications ALTER COLUMN current_revision_id DROP NOT NULL;
ALTER TABLE publications ALTER COLUMN is_campaign DROP NOT NULL;
CREATE OR REPLACE FUNCTION publication_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (NEW.id,NEW.workspace_id,NEW.account_id,NEW.platform_note_id,NEW.url,NEW.recorded_by) IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.account_id,OLD.platform_note_id,OLD.url,OLD.recorded_by) THEN RAISE EXCEPTION 'Publication identity cannot be rewritten'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_publication_identity BEFORE UPDATE OR DELETE ON publications FOR EACH ROW EXECUTE FUNCTION publication_identity_guard();
ALTER TABLE topic_decisions ADD COLUMN owner_id uuid;
ALTER TABLE topic_decisions ADD FOREIGN KEY(workspace_id,owner_id) REFERENCES memberships(workspace_id,id);
ALTER TABLE topic_decisions DISABLE TRIGGER topic_decision_immutable;
UPDATE topic_decisions d SET owner_id=t.accepted_owner_id FROM topics t WHERE t.id=d.topic_id AND d.decision='accepted';
ALTER TABLE topic_decisions ENABLE TRIGGER topic_decision_immutable;
CREATE UNIQUE INDEX topic_single_acceptance ON topic_decisions(topic_id) WHERE decision='accepted';
ALTER TABLE upload_sessions ADD COLUMN account_id uuid;
ALTER TABLE upload_sessions ADD FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id);
ALTER TABLE file_objects ADD COLUMN account_id uuid;
ALTER TABLE file_objects ADD COLUMN purpose text;
ALTER TABLE file_objects ADD FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id);
-- Hash deduplication must not share private files between accounts or purposes.
ALTER TABLE file_objects DROP CONSTRAINT file_objects_workspace_id_sha256_is_preview_key;
CREATE UNIQUE INDEX file_account_purpose_hash ON file_objects(workspace_id,account_id,purpose,sha256,is_preview);
