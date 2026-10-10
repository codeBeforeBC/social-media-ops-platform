# 内部契约

当前生成源与设计v1.2一致：[OpenAPI](openapi.json)64条路径/78个操作，[领域Schema](domain.schema.json)109个定义。已实现端点标记implemented；数据导入/指标/报告/反馈等planned端点不代表运行接入。

入口为 `tools/s0/generate-contracts.py`，读取05的保留领域定义，并加载S1、S3来源/选题/AI扩展与 `tools/s11/contracts.py`。生成物不单独手改。复杂CHECK/触发器/外键以SQL迁移为准；Prisma部分唯一索引无法正确表达关系基数，保留一对多关系及SQL约束。

```sh
python3 tools/s0/generate-contracts.py
python3 -m venv /tmp/yoyo-s0-validation
/tmp/yoyo-s0-validation/bin/pip install -r tools/s0/validation-requirements.txt
CONTRACT_VALIDATION_REPORT=docs/evidence/s11/contract-validation.json /tmp/yoyo-s0-validation/bin/python tools/s0/validate-contracts.py
```

校验OpenAPI/JSON Schema、引用、取消路径/字段、角色和26个正反样例。HTTP集成测试逐次核对已实现响应。采纳返回200及唯一TopicDecision；独立笔记无内部稿/活动字段或回收事件；上传必须带授权账号及import_screenshot/import_table/source_evidence目的。文件成功不表示指标已确认。旧证据保留在docs/evidence/s0–s4，不作为当前验收。

AI候选/完整输出Schema由tools/s11/export-ai-schema.ts从网关Zod边界直接生成，缓存与持久请求响应使用同一形状；事实白名单、未知工时null、取消输入缺口和范围版本仍由运行守卫核验。
