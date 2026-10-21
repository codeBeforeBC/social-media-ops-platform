-- CHANGE-012: keep individual identities, sessions, ownership and workspace boundaries.
INSERT INTO audit_logs(workspace_id,actor_type,action,object_type,object_id,details,request_id)
SELECT workspace_id,'service','membership.roles_unified','membership',id,
       jsonb_build_object('previous_roles',roles,'roles',ARRAY['admin']::text[],'change','CHANGE-012'),gen_random_uuid()
FROM memberships WHERE roles IS DISTINCT FROM ARRAY['admin']::text[];

UPDATE memberships
SET roles=ARRAY['admin']::text[], version=version+1, updated_at=now()
WHERE roles IS DISTINCT FROM ARRAY['admin']::text[];

ALTER TABLE memberships ALTER COLUMN roles SET DEFAULT ARRAY['admin']::text[];
