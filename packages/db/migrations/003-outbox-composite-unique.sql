-- Prisma要求1:1复合关系的定义侧也显式声明复合唯一键；保留outbox_id永久唯一。
ALTER TABLE jobs ADD CONSTRAINT jobs_workspace_outbox_unique UNIQUE(workspace_id,outbox_id);
