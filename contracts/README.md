# 内部契约

- [OpenAPI](openapi.json)：OpenAPI 3.1，98条路径、119个操作；S1已实现操作显式标记，其余仍planned。
- [领域 Schema](domain.schema.json)：JSON Schema 2020-12，165个定义，含实体、状态、关键请求与AI结构。
- 业务约束见 [ADR-002](../docs/decisions/ADR-002-领域与接口收口.md)，S1实现与验证范围见 [S1证据](../docs/evidence/s1/README.md)。S0的90路径/110操作/155定义为当时历史快照，原证据保留。

生成源为 `tools/s0/generate-contracts.py`，读取原05/06并应用明确映射，再加载 `tools/s1/contract-extension.py` 补充S1实际请求/响应及实现标记；生成物不应单独修改。复杂数据库约束以SQL迁移为准。

复现：

```sh
python3 tools/s0/generate-contracts.py
python3 -m venv /tmp/yoyo-s0-validation
/tmp/yoyo-s0-validation/bin/pip install -r tools/s0/validation-requirements.txt
CONTRACT_VALIDATION_REPORT=docs/evidence/s1/contract-validation.json /tmp/yoyo-s0-validation/bin/python tools/s0/validate-contracts.py
```

生成清单和本轮验证写入 `docs/evidence/s1/`，不覆盖历史S0报告。该命令验证格式、引用、关键请求形状和21个合成样例，不启动产品服务。S1真实HTTP测试另外逐次核对已实现响应与OpenAPI，尚未实现的业务路由不算运行通过。
