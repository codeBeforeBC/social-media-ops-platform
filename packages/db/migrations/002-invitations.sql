CREATE TABLE invitations (
 token_hash text PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),user_id uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL,accepted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,user_id) REFERENCES memberships(workspace_id,user_id)
);
