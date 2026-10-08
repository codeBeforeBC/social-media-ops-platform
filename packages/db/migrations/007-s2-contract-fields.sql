ALTER TABLE asset_relations ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE asset_relations ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE asset_usages ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE asset_usages ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE brand_rules ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE brand_rules ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE brand_rules ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
