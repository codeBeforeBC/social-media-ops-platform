CREATE TABLE export_packages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,account_id uuid NOT NULL,content_id uuid NOT NULL,revision_id uuid NOT NULL,
 payload_hash text NOT NULL,created_by uuid NOT NULL,job_id uuid,file_id uuid,manifest jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,id),UNIQUE(content_id,revision_id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id),FOREIGN KEY(workspace_id,content_id) REFERENCES contents(workspace_id,id),
 FOREIGN KEY(workspace_id,revision_id) REFERENCES content_revisions(workspace_id,id),FOREIGN KEY(workspace_id,created_by) REFERENCES memberships(workspace_id,id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id),FOREIGN KEY(workspace_id,file_id) REFERENCES file_objects(workspace_id,id)
);
