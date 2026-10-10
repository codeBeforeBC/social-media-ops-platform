INSERT INTO metric_definitions VALUES
 ('net_followers','1','净增粉','人','account',ARRAY['derived']),
 ('follows_per_1000_reads','1','千次阅读关注','人/千次','publication',ARRAY['derived']),
 ('interaction_count_rate','1','互动次数率','%','publication',ARRAY['derived']),
 ('weighted_average_watch_seconds','1','加权平均观看时长','秒','account',ARRAY['derived']);
INSERT INTO metric_definitions SELECT key||'_interval_delta',definition_version,label||'（区间增量）',unit,scope,ARRAY['derived'] FROM metric_definitions WHERE key IN ('impressions','reads','plays','likes','saves','comments','shares','attributed_follows');
