# CHANGE-024 点击确认删除，无需输入名称

2026-10-29；Codex；工作目录 `/Users/junlong/projects/social-mdeida-ops-platform`，分支 `codex/s9-acceptance`，`ad4edd7` 加CHANGE-023及本轮未提交修改。状态仅在[开发进度](../../tracking/开发进度.md)维护。

删除确认区保留目标名称/内部ID与确认、取消按钮，移除名称输入及匹配门槛；点击确认即可提交。DELETE请求只要求 `expected_version` 和 `confirmed:true`，服务端也不再要求名称。版本冲突须读取最新账号后再次点击确认。权限、CSRF、幂等、关联/在途任务保护、审计及旧请求不复活规则保持。

- [13项账号/删除检查](account-tests.log)、[3项浏览器流程](browser.log)、[类型](typecheck.log)、[构建](build.log)、[25契约样例](contract-validation.json)和[Docker构建](docker-build.log)通过；浏览器确认区域无输入框、确认按钮立即可用，取消/失败重试/数据保护及版本冲突仍正常。
- 首次两组接口测试未指定串行，重置共用的可弃测试库造成初始化失败；[首轮](account-tests-first.log)保留，按仓库默认方式加 `--test-concurrency=1` 后13项通过。业务库未参与测试重置。
- [本地更新](local-upgrade.log)仅no-deps更新API；[运行验证](local-runtime.json)确认59业务表count/hash、默认身份、AI配置保持，40迁移不变，前端资源/后端命令与已测编译一致；旧API回滚镜像已核验，原受限备份保持。
- [实际页面只读检查](local-browser.json)确认无名称输入、确认按钮可点击、取消保持原账号，1440/320px无横向溢出，0写请求/0页面错误。[桌面](screenshots/local-delete-1440.png)、[窄屏](screenshots/local-delete-320.png)遮挡原账号信息。本轮没有删除当前用户账号。

无新增真实模型/来源采集或平台写操作，无迁移；测试服务最终停止、卷保留。此变更只简化确认交互，有历史关联的账号仍不能删除；CHANGE-023原实现证据保留为历史，不再定义当前名称输入要求。本轮未重跑无关的全量产品测试，原发布门禁保持。
