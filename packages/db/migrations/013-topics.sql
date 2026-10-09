ALTER TABLE source_observations ADD UNIQUE(workspace_id,id);
CREATE TABLE topics (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,account_id uuid NOT NULL,created_by uuid NOT NULL,
 generation_request_id uuid NOT NULL,candidate_position integer NOT NULL, parent_topic_id uuid,
 candidate jsonb NOT NULL,score numeric(5,2) NOT NULL CHECK(score>=0 AND score<=100),
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','accepted','rejected','expired')),
 missing_inputs text[] NOT NULL DEFAULT '{}',warnings text[] NOT NULL DEFAULT '{}',expires_at timestamptz,
 accepted_content_id uuid,accepted_revision_id uuid,brief_job_id uuid,accepted_owner_id uuid,accepted_media_type text,
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),UNIQUE(generation_request_id,candidate_position),
 FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id),FOREIGN KEY(workspace_id,created_by) REFERENCES memberships(workspace_id,id),
 FOREIGN KEY(workspace_id,generation_request_id) REFERENCES ai_requests(workspace_id,id),FOREIGN KEY(workspace_id,parent_topic_id) REFERENCES topics(workspace_id,id),
 FOREIGN KEY(workspace_id,accepted_content_id) REFERENCES contents(workspace_id,id),FOREIGN KEY(workspace_id,accepted_revision_id) REFERENCES content_revisions(workspace_id,id),
 FOREIGN KEY(workspace_id,brief_job_id) REFERENCES jobs(workspace_id,id),FOREIGN KEY(workspace_id,accepted_owner_id) REFERENCES memberships(workspace_id,id)
);
CREATE TABLE topic_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,topic_id uuid NOT NULL,source_item_id uuid,observation_id uuid,
 claim text NOT NULL,evidence_kind text NOT NULL CHECK(evidence_kind IN ('fact','inference','original_hypothesis')),
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(workspace_id,topic_id) REFERENCES topics(workspace_id,id),
 FOREIGN KEY(workspace_id,source_item_id) REFERENCES source_items(workspace_id,id),FOREIGN KEY(workspace_id,observation_id) REFERENCES source_observations(workspace_id,id),
 CHECK(evidence_kind<>'fact' OR (source_item_id IS NOT NULL AND observation_id IS NOT NULL))
);
CREATE TRIGGER topic_evidence_immutable BEFORE UPDATE OR DELETE ON topic_evidence FOR EACH ROW EXECUTE FUNCTION s2_immutable();
CREATE TABLE topic_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,topic_id uuid NOT NULL,actor_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('accepted','rejected','variant')),reason text NOT NULL,content_id uuid,
 decided_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(workspace_id,topic_id) REFERENCES topics(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_id) REFERENCES memberships(workspace_id,id),FOREIGN KEY(workspace_id,content_id) REFERENCES contents(workspace_id,id)
);
CREATE TRIGGER topic_decision_immutable BEFORE UPDATE OR DELETE ON topic_decisions FOR EACH ROW EXECUTE FUNCTION s2_immutable();
ALTER TABLE contents ADD COLUMN media_type text NOT NULL DEFAULT 'graphic' CHECK(media_type IN ('graphic','video'));
ALTER TABLE contents ADD COLUMN owner_id uuid;
ALTER TABLE contents ADD FOREIGN KEY(workspace_id,owner_id) REFERENCES memberships(workspace_id,id);
ALTER TABLE contents ADD COLUMN topic_id uuid;
ALTER TABLE contents ADD FOREIGN KEY(workspace_id,topic_id) REFERENCES topics(workspace_id,id);
CREATE UNIQUE INDEX content_single_topic ON contents(topic_id) WHERE topic_id IS NOT NULL;
ALTER TABLE contents ADD COLUMN current_revision_id uuid;
ALTER TABLE contents ADD FOREIGN KEY(workspace_id,current_revision_id) REFERENCES content_revisions(workspace_id,id);
CREATE INDEX topic_inventory ON topics(workspace_id,account_id,created_at DESC,id DESC);
