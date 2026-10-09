-- Evidence must reference the observation of that exact source item in the same workspace.
ALTER TABLE source_observations ADD UNIQUE(workspace_id,source_item_id,id);
ALTER TABLE topic_evidence ADD FOREIGN KEY(workspace_id,source_item_id,observation_id) REFERENCES source_observations(workspace_id,source_item_id,id);
