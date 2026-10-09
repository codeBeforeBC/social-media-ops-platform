ALTER TABLE contents ADD COLUMN supersedes_content_id uuid;
ALTER TABLE contents ADD COLUMN revision_reason text;
ALTER TABLE contents ADD FOREIGN KEY(workspace_id,supersedes_content_id) REFERENCES contents(workspace_id,id);
ALTER TABLE contents ADD CHECK(supersedes_content_id IS NULL OR supersedes_content_id<>id);
