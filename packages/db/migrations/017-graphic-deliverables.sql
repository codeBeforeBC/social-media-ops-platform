CREATE TABLE media_deliverables (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,revision_id uuid NOT NULL,file_id uuid NOT NULL,
 role text NOT NULL CHECK(role='publish_image'),position integer NOT NULL CHECK(position>0),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(revision_id,position),
 FOREIGN KEY(workspace_id,revision_id) REFERENCES content_revisions(workspace_id,id),
 FOREIGN KEY(workspace_id,file_id) REFERENCES file_objects(workspace_id,id)
);
