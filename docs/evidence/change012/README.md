# CHANGE-012：个人登录、全员管理员、无初始化凭据

2026-10-21，Codex；目录 `/Users/junlong/projects/social-mdeida-ops-platform`，分支 `codex/s9-acceptance`，Git基线 `0f9d64d` 加本轮未提交修改。这里只记录本轮范围的验证；旧rc15离线包没有更新，不代表完整发布门禁通过。

- 首次设置直接填写工作区/姓名/邮箱/密码，保留CSRF、Origin、限流及一次性事务锁；移除公开初始化凭据工具。
- 保留个人登录与邀请，所有成员在本工作区内均为管理员；API拒绝非admin角色，界面取消角色选择。个人通知、审计操作者与跨工作区/文件目的边界保留。
- 新增038迁移统一旧成员角色，保留身份、停用状态、业务归属和会话，记录旧角色及变更审计；停用成员不复活。尚未接受的邀请不能替代最后一位可登录管理员。
- 内部邀请响应加密改用idempotency_secret，兼容旧setup_token；旧密文仍可解密，重放返回当前成员状态及原邀请凭据。新实例不再生成setup_token。

验证均使用明确合成输入，不请求真实来源/模型，不迁移使用库。

| 检查 | 结果与证据 |
|---|---|
| 源码构建/类型 | [build.log](build.log)、[typecheck.log](typecheck.log)，通过 |
| 契约生成/校验 | 75路径/90操作/125Schema，30个样例通过；[manifest](contract-manifest.json)、[校验](contract-validation.json) |
| 集成 | 专用可重置yoyo_change012_test；[integration.log](integration.log)，134/134通过；包含实际旧表升级、停用/邀请/工作区隔离与旧密钥兼容 |
| 浏览器 | [browser.log](browser.log)，16/16通过，含无凭据首次设置、新成员独立登录/共享内容/成员管理及原三导航回归 |
| 当前源码Docker | 独立yoyo-change012项目，网页3002/存储59002；[构建启动](docker-final-build.log)、[运行](docker-runtime.json)，8项通过：登录要求、无凭据首次创建、邀请不替代最后管理员、个人管理员共享编辑、拒绝降级、真实worker任务、通知按人隔离、新内部密钥与旧公开工具退出 |
| 历史SQL | 001–037与Git基线逐字核对，详见[产物实态](source-state.json) |

首轮失败保留：[集成首轮](integration-first.log)是旧升级断言仍期待editor/viewer；[定向复验](retirement-recheck.log)通过。[浏览器首轮](browser-first.log)包含新增流程保留hash导致用例误等首页、限流和新测试库白名单缺失；[第二轮](browser-second.log)包含OCR已实现但仍期待not_implemented、多个待办链接未按批次定位。仅修正测试夹具/断言，未关闭产品限流或降低权限边界；BUG-033记录测试漂移。

测试依赖使用隔离S8测试存储/解析器，结束后停止；Docker验证实例停止且卷保留，原dev数据库54329/存储59000/解析器59010不变。使用实例迁移、旧rc15更新、新离线发布包/干净clone/HTTPS与规模发布复验、跨日RPO及暂缓真实数据验收未在本轮执行。
