# CHANGE-030 移除账号验证区后台指标信息

2026-10-30；Codex；`/Users/junlong/projects/social-mdeida-ops-platform`，`codex/s9-acceptance`/`34317f8` 加既有未提交修改，保留CHANGE-027/028/029/BUG-042。状态仅见[开发进度](../../tracking/开发进度.md)。

按用户明确要求，从[验证面板](../../../apps/web/src/account-verification.tsx)移除“后台指标”状态、相关能力说明及不用的标签映射。保留登录核对指引与人工确认含义；后台能力字段、接口、真实结果和权限规则保持，无依赖或迁移新增。[交互基线](../../yoyo-workbench-v1.0/02-页面与交互规范.md)的新约定覆盖原展示说明。

- [3项专项通过](browser-tests.log)：公开/登录匹配、错号/失败恢复/重试、人工确认/换浏览器，以及8组指引状态均断言不再显示后台指标信息。复用现有[页面用例](../../../tests/browser.spec.ts)，没有为静态删除新增测试框架；本轮不重复47项全页面/后端/契约全套。
- [构建](build.log)、[类型](typecheck.log)、[源码Docker](docker-build.log)通过。
- [实际只读结果](local-browser.json)：1440/390/320不含后台指标或后台数据能力说明，保留登录指引，0写请求/0页面错误；[桌面](screenshots/local-verification-1440.png)、[390](screenshots/local-verification-390.png)、[320](screenshots/local-verification-320.png)个人信息通过临时浏览器样式隐藏。受控截图另存本目录，BUG-042历史截图从私有副本恢复。
- [部署](local-deploy.log)、[核对](local-runtime.json)：只no-deps更新本地API前端，JS/CSS及后端编译匹配，62业务表完整count/hash、默认身份与私有AI配置保持，41迁移不变。

网页3000/存储59001，worker/media/scheduler、宿主桥接59025及dev依赖保持；S8测试服务停止且卷保留。回滚镜像`yoyo-local:change030-api-rollback`已核对，沿用已有受限备份，无新数据备份。未发起真实账号验证/修改/删除、模型或采集请求；未提交/推送，原发布门禁保持。原始日志保留在私有目录，公开仅规范行末空白。
