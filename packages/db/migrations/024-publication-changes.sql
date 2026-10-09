CREATE TABLE publication_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,publication_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('edited','deleted','reposted')),actual_revision_id uuid,reposted_publication_id uuid,
 evidence text NOT NULL CHECK(length(evidence)>0),occurred_at timestamptz NOT NULL,recorded_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,publication_id) REFERENCES publications(workspace_id,id),FOREIGN KEY(workspace_id,actual_revision_id) REFERENCES content_revisions(workspace_id,id),
 FOREIGN KEY(workspace_id,reposted_publication_id) REFERENCES publications(workspace_id,id),FOREIGN KEY(workspace_id,recorded_by) REFERENCES memberships(workspace_id,id),
 CHECK((kind='edited' AND actual_revision_id IS NOT NULL AND reposted_publication_id IS NULL) OR (kind='deleted' AND actual_revision_id IS NULL AND reposted_publication_id IS NULL) OR (kind='reposted' AND actual_revision_id IS NULL AND reposted_publication_id IS NOT NULL))
);
CREATE TRIGGER immutable_publication_change BEFORE UPDATE OR DELETE ON publication_changes FOR EACH ROW EXECUTE FUNCTION s2_immutable();
