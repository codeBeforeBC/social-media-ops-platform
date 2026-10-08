ALTER TABLE file_objects ADD COLUMN is_preview boolean NOT NULL DEFAULT false;
ALTER TABLE file_objects DROP CONSTRAINT file_objects_workspace_id_sha256_key;
ALTER TABLE file_objects ADD UNIQUE(workspace_id,sha256,is_preview);
CREATE INDEX file_media_status ON file_objects(workspace_id,preview_status) WHERE is_preview=false;
