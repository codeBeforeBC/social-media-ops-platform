-- Keep historical identity and ownership; only browser login sessions are transient.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE instance_state ADD COLUMN default_workspace_id uuid REFERENCES workspaces(id);
ALTER TABLE instance_state ADD COLUMN default_member_id uuid;
ALTER TABLE instance_state ADD CONSTRAINT instance_default_member_scope
  FOREIGN KEY(default_workspace_id,default_member_id) REFERENCES memberships(workspace_id,id);
ALTER TABLE instance_state ADD CONSTRAINT instance_default_pair
  CHECK((default_workspace_id IS NULL)=(default_member_id IS NULL));
DELETE FROM sessions;
