-- Frozen candidates and reviewed versions preserve all provenance and version fields.
CREATE OR REPLACE FUNCTION frozen_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.frozen AND (TG_OP='DELETE' OR NEW IS DISTINCT FROM OLD) THEN RAISE EXCEPTION 'Frozen revision cannot be rewritten'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
