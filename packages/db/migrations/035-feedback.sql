CREATE TABLE feedback (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,account_id uuid NOT NULL,publication_id uuid,
 source_url text,source_time timestamptz,text text NOT NULL CHECK(length(text) BETWEEN 1 AND 10000),author_alias text,
 category text NOT NULL DEFAULT 'other' CHECK(category IN ('compliment','question','story','complaint','other')),
 consent_status text NOT NULL DEFAULT 'unknown' CHECK(consent_status IN ('unknown','internal_only','approved','revoked')),
 permitted_usage jsonb NOT NULL DEFAULT '{"public_reply":false,"topic_reference":false}',
 reply_draft text NOT NULL DEFAULT '',quotes jsonb NOT NULL DEFAULT '[]',topic_leads jsonb NOT NULL DEFAULT '[]',
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','triaged','archived')),
 created_by uuid NOT NULL,job_id uuid,ai_run_id uuid,version int NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,publication_id) REFERENCES publications(workspace_id,id),
 FOREIGN KEY(workspace_id,created_by) REFERENCES memberships(workspace_id,id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id),FOREIGN KEY(workspace_id,ai_run_id) REFERENCES ai_runs(workspace_id,id)
);
CREATE INDEX feedback_history ON feedback(workspace_id,account_id,created_at DESC,id DESC);
CREATE FUNCTION s8_feedback_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.workspace_id,NEW.account_id,NEW.id) IS DISTINCT FROM (OLD.workspace_id,OLD.account_id,OLD.id) THEN RAISE EXCEPTION 'feedback identity immutable' USING ERRCODE='23514'; END IF;
 IF NEW.publication_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM publications WHERE workspace_id=NEW.workspace_id AND account_id=NEW.account_id AND id=NEW.publication_id) THEN RAISE EXCEPTION 'feedback account mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.consent_status<>'approved' THEN NEW.permitted_usage='{"public_reply":false,"topic_reference":false}'; END IF;
 IF NOT (NEW.permitted_usage->>'public_reply')::boolean THEN NEW.reply_draft='';NEW.quotes='[]'; END IF;
 IF NOT (NEW.permitted_usage->>'topic_reference')::boolean THEN NEW.topic_leads='[]'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER feedback_guard BEFORE INSERT OR UPDATE ON feedback FOR EACH ROW EXECUTE FUNCTION s8_feedback_guard();
