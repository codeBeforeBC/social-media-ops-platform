CREATE TABLE metric_definitions (
 key text NOT NULL, definition_version text NOT NULL, label text NOT NULL, unit text NOT NULL,scope text NOT NULL,kinds text[] NOT NULL,
 PRIMARY KEY(key,definition_version)
);
INSERT INTO metric_definitions VALUES
 ('followers','1','粉丝总数','人','account',ARRAY['snapshot']),('new_followers','1','新增关注','人','account',ARRAY['interval']),('unfollows','1','取关','人','account',ARRAY['interval']),
 ('impressions','1','曝光','次','both',ARRAY['cumulative','interval']),('reads','1','阅读','次','publication',ARRAY['cumulative','interval']),('plays','1','播放','次','publication',ARRAY['cumulative','interval']),
 ('likes','1','点赞','次','publication',ARRAY['cumulative','interval']),('saves','1','收藏','次','publication',ARRAY['cumulative','interval']),('comments','1','评论','次','publication',ARRAY['cumulative','interval']),('shares','1','分享','次','publication',ARRAY['cumulative','interval']),
 ('attributed_follows','1','笔记归因新增关注','人','publication',ARRAY['cumulative','interval']),('likes_saves_combined','1','获赞与收藏（组合）','次','both',ARRAY['snapshot','cumulative','interval']),
 ('completion_rate','1','完播率','%','publication',ARRAY['interval']),('average_watch_seconds','1','平均观看时长','秒','publication',ARRAY['interval']),('watch_count','1','对应观看次数','次','publication',ARRAY['interval']);
CREATE TABLE calculations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,account_id uuid NOT NULL,publication_id uuid,
 metric_key text NOT NULL,calculation_version text NOT NULL,input_observation_ids uuid[] NOT NULL,
 window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,traffic_type text NOT NULL,source_definition text NOT NULL,time_precision text NOT NULL,
 rounding_rule text NOT NULL,value numeric(24,6),missing_reason text,is_approximate boolean NOT NULL,fingerprint text NOT NULL UNIQUE,
 validity text NOT NULL DEFAULT 'current' CHECK(validity IN ('current','stale')),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),CHECK(window_start<window_end),CHECK(value IS NOT NULL OR missing_reason IS NOT NULL),
 FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id),FOREIGN KEY(workspace_id,publication_id) REFERENCES publications(workspace_id,id)
);
CREATE INDEX calculation_scope ON calculations(workspace_id,account_id,window_start,window_end);
CREATE TABLE report_calculations (
 workspace_id uuid NOT NULL,report_id uuid NOT NULL,calculation_id uuid NOT NULL,PRIMARY KEY(report_id,calculation_id),
 FOREIGN KEY(workspace_id,report_id) REFERENCES reports(workspace_id,id),FOREIGN KEY(workspace_id,calculation_id) REFERENCES calculations(workspace_id,id)
);
CREATE OR REPLACE FUNCTION metric_invalidate_reports(scope uuid,observations uuid[],why text,request uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE calculations SET validity='stale' WHERE workspace_id=scope AND input_observation_ids && observations;
 INSERT INTO report_invalidations(workspace_id,report_id,observation_id,reason,request_id)
 SELECT DISTINCT scope,refs.report_id,refs.observation_id,why,request FROM (
 SELECT report_id,observation_id FROM report_observations WHERE workspace_id=scope AND observation_id=ANY(observations)
 UNION ALL SELECT r.report_id,unnest(c.input_observation_ids) FROM report_calculations r JOIN calculations c ON c.id=r.calculation_id WHERE r.workspace_id=scope AND c.input_observation_ids && observations
 ) refs WHERE refs.observation_id=ANY(observations);
 UPDATE reports SET status='stale',version=version+1,updated_at=now() WHERE workspace_id=scope AND id IN (
 SELECT report_id FROM report_observations WHERE workspace_id=scope AND observation_id=ANY(observations)
 UNION SELECT r.report_id FROM report_calculations r JOIN calculations c ON c.id=r.calculation_id WHERE r.workspace_id=scope AND c.input_observation_ids && observations);
END $$;
CREATE FUNCTION calculation_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(OLD)-'validity')<>(to_jsonb(NEW)-'validity') THEN RAISE EXCEPTION 'calculation history is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER calculation_history BEFORE UPDATE OR DELETE ON calculations FOR EACH ROW EXECUTE FUNCTION calculation_history_guard();
