CREATE FUNCTION import_job_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.type='import.parse' AND NEW.state IN ('queued','running','failed','cancelled') THEN
  UPDATE import_batches SET status=CASE NEW.state WHEN 'queued' THEN 'uploaded' WHEN 'running' THEN 'parsing' ELSE 'failed' END,version=version+1,updated_at=now()
  WHERE id::text=NEW.input->>'batch_id' AND workspace_id=NEW.workspace_id AND status IN ('uploaded','parsing','failed');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER import_job_lifecycle AFTER INSERT OR UPDATE OF state ON jobs FOR EACH ROW EXECUTE FUNCTION import_job_status();
CREATE FUNCTION metric_new_input_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected uuid[];
BEGIN
 SELECT array_agg(id) INTO affected FROM calculations WHERE workspace_id=NEW.workspace_id AND account_id=NEW.account_id AND validity='current'
 AND traffic_type=NEW.metric->>'traffic_type' AND source_definition=NEW.metric->>'source_definition' AND time_precision=NEW.metric->>'time_precision'
 AND (publication_id IS NULL OR publication_id=NEW.publication_id)
 AND (COALESCE((NEW.metric->>'observed_at')::timestamptz,(NEW.metric->>'window_start')::timestamptz) BETWEEN window_start AND window_end);
 IF affected IS NOT NULL THEN
  UPDATE calculations SET validity='stale' WHERE id=ANY(affected);
  INSERT INTO report_invalidations(workspace_id,report_id,observation_id,reason,request_id)
  SELECT NEW.workspace_id,report_id,NEW.id,'窗口新增已确认观察，请重算',gen_random_uuid() FROM report_calculations WHERE calculation_id=ANY(affected);
  UPDATE reports SET status='stale',version=version+1,updated_at=now() WHERE id IN (SELECT report_id FROM report_calculations WHERE calculation_id=ANY(affected));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER metric_new_input AFTER INSERT ON metric_observations FOR EACH ROW EXECUTE FUNCTION metric_new_input_invalidation();
CREATE FUNCTION import_row_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status='confirmed' OR OLD.is_example AND (NEW.metric IS DISTINCT FROM OLD.metric OR NEW.status<>OLD.status OR NEW.is_example<>OLD.is_example) OR NEW.raw IS DISTINCT FROM OLD.raw THEN RAISE EXCEPTION 'import row history is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER import_row_history BEFORE UPDATE OR DELETE ON import_rows FOR EACH ROW EXECUTE FUNCTION import_row_history_guard();
