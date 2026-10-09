ALTER TABLE contents ADD COLUMN planned_publish_at timestamptz;
ALTER TABLE contents ADD COLUMN internal_notes text NOT NULL DEFAULT '';
ALTER TABLE contents ADD COLUMN estimated_hours numeric CHECK(estimated_hours>=0);
