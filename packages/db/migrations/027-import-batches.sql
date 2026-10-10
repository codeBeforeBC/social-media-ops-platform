CREATE TABLE import_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, account_id uuid NOT NULL,
 created_by uuid NOT NULL, source_type text NOT NULL CHECK(source_type IN ('manual','csv','xlsx')),
 input_file_ids uuid[] NOT NULL DEFAULT '{}', parser_version text NOT NULL DEFAULT 'table-v1',
 status text NOT NULL CHECK(status IN ('uploaded','parsing','needs_confirmation','committing','confirmed','partially_confirmed','failed','reverted')),
 mapping jsonb NOT NULL DEFAULT '{}', confirmed_by uuid, confirmed_at timestamptz, version int NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,created_by) REFERENCES memberships(workspace_id,id), FOREIGN KEY(workspace_id,confirmed_by) REFERENCES memberships(workspace_id,id)
);
CREATE TABLE import_rows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, batch_id uuid NOT NULL,
 row_number int NOT NULL, file_id uuid, raw jsonb NOT NULL, metric jsonb, error text,
 status text NOT NULL CHECK(status IN ('valid','conflict','unmatched','excluded','confirmed')),
 is_example boolean NOT NULL DEFAULT false, corrections jsonb NOT NULL DEFAULT '[]',
 confirmed_by uuid, confirmed_at timestamptz, version int NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(batch_id,row_number), UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,batch_id) REFERENCES import_batches(workspace_id,id),
 FOREIGN KEY(workspace_id,file_id) REFERENCES file_objects(workspace_id,id), FOREIGN KEY(workspace_id,confirmed_by) REFERENCES memberships(workspace_id,id)
);
CREATE INDEX import_batch_page ON import_batches(workspace_id,account_id,created_at DESC,id DESC);
CREATE INDEX import_row_page ON import_rows(batch_id,row_number);
