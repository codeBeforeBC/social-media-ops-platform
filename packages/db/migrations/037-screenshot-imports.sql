-- Preserve existing batches; only extend the supported import source.
ALTER TABLE import_batches DROP CONSTRAINT import_batches_source_type_check;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_source_type_check
 CHECK(source_type IN ('manual','csv','xlsx','screenshot'));
