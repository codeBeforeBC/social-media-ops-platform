# S0 内部契约

- [OpenAPI](openapi.json)：OpenAPI3.1，90条路径、110个操作；所有操作仍planned。
- [领域 Schema](domain.schema.json)：JSON Schema2020-12，155个定义，含实体、状态、关键请求与AI结构。
- 业务约束及相对原文的细化见 [ADR-002](../docs/decisions/ADR-002-领域与接口收口.md)。

生成源为`tools/s0/generate-contracts.py`，读取原05/06并应用明确的请求和字段映射；生成物不应单独修改。扩展式实体输出用于设计收口；实施模块时继续补专用响应类型，并按同一生成源更新，不把文本字段推断当完整数据库DDL。

复现：

```sh
python3 tools/s0/generate-contracts.py
python3 -m venv /tmp/yoyo-s0-validation
/tmp/yoyo-s0-validation/bin/pip install -r tools/s0/validation-requirements.txt
/tmp/yoyo-s0-validation/bin/python tools/s0/validate-contracts.py
```

输出证据写入`docs/evidence/s0/contract-validation.json`。该命令验证格式、引用、关键请求形状和21个合成样例；不会启动API、数据库、来源或模型。实际集成验收在后续阶段执行。
