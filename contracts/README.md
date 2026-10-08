# 内部契约

- [OpenAPI](openapi.json)：OpenAPI 3.1，103条路径、124个操作；S1/S2已实现操作显式标记，其余仍planned。
- [领域 Schema](domain.schema.json)：JSON Schema 2020-12，165个定义，含实体、状态、关键请求与AI结构。
- 业务约束见 [ADR-002](../docs/decisions/ADR-002-领域与接口收口.md)，S1实现与验证范围见 [S1证据](../docs/evidence/s1/README.md)。S0的90路径/110操作/155定义为当时历史快照，原证据保留。

生成源为 `tools/s0/generate-contracts.py`，读取原05/06并应用明确映射，再加载 `tools/s1/contract-extension.py` 补充S1实际请求/响应及实现标记；S2再运行 `tools/s2/contracts.py` 应用实际PNG/PDF写入约束及请求/响应；生成物不应单独修改。复杂数据库约束以SQL迁移为准。

复现：

```sh
python3 tools/s0/generate-contracts.py
python3 tools/s2/contracts.py
python3 -m venv /tmp/yoyo-s0-validation
/tmp/yoyo-s0-validation/bin/pip install -r tools/s0/validation-requirements.txt
CONTRACT_VALIDATION_REPORT=docs/evidence/s2/contract-validation.json /tmp/yoyo-s0-validation/bin/python tools/s0/validate-contracts.py
```

当前S2验证写入 `docs/evidence/s2/`，不覆盖历史S0/S1报告。该命令验证格式、引用、关键请求形状和21个合成样例，不启动产品服务。S1/S2真实HTTP测试另外逐次核对已实现响应与OpenAPI，尚未实现的业务路由不算运行通过。

格式写入范围以[ADR-004](../docs/decisions/ADR-004-S2首版PNG素材范围.md)为准：purpose=asset仅PNG，purpose=guideline仅PDF；AssetCreate/AssetPatch类别仅2d/render。历史样例和通用枚举中的工程/音视频类型保留后续扩展含义，不代表本版允许上传。PDF规范页码按已解析页数校验，激活需人工核对；其他素材格式拒绝。实际S2验收见[报告](../docs/evidence/s2/README.md)。
