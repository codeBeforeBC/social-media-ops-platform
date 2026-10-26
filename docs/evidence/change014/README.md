# CHANGE-014 本地单实例免登录实现与交接

2026-10-26，Codex。工作目录 `/Users/junlong/projects/social-mdeida-ops-platform`，分支codex/s9-acceptance，基线c993d0f加本轮实现；最终提交通过LOG-111/Git定位。范围为已批准的[免登录规划](../../plans/CHANGE-014-本地单实例免登录规划.md)，不代表完整发布门禁或真实后台数据验收已完成。

- 默认用户/工作区持久映射：空库自动建立，单用户旧库沿用原ID，歧义旧库明确选择；39新增迁移保留001–038和历史归属，只废止旧浏览器登录session。
- 删除工作台登录/退出/邀请/成员/资料/负责人选择，旧身份接口410；新GET /instance与/request/csrf不代表登录。
- 保留Host/Origin/CSRF、私有文件、业务范围、版本、幂等、预算及旧任务守卫。新任务默认归属；旧无效发起者在处理前拒绝，不改写原created_by；通知中心保留历史收件人并合并事件展示/已读。
- 保留默认实例之外的历史空间，不继续调度其Outbox或过期清理上传。平台账号授权、Bridge与模型密钥仍独立配置。真实使用实例没有注入合成测试数据。

## 验证

| 项目 | 证据与结果 |
|---|---|
| 构建/类型 | [build.log](build.log)、[typecheck.log](typecheck.log)通过 |
| 契约 | 67路径/80操作/118Schema，25样例；[manifest](contract-manifest.json)、[校验](contract-validation.json)通过 |
| 最终整套集成 | [integration-final.log](integration-final.log)，142/142通过，最终全套运行一次 |
| 浏览器回归 | [browser.log](browser.log)，16/16通过；服务失败/技术令牌重试仅UI状态夹具，不冒充实际来源失败 |
| 关键接口红绿 | 无Cookie默认上下文：[红](default-context-red.log)/[绿](default-context-green.log)；无登录写入：[红](local-write-red.log)/[绿](local-write-green.log)；失效旧任务：[红](old-job-red.log)/[绿](foreign-expiry-green.log)，最终完整结果以上方142项为准 |
| 迁移与请求 | [最终迁移回归](integration-final.log)、[bootstrap-selection.log](bootstrap-selection.log)、[context-requests-collection.log](context-requests-collection.log)及最终全套；冷启动/旧ID/歧义选择/过期令牌、旧密钥和在途任务均覆盖 |
| 未选空间清理 | [红](foreign-expiry-red.log)、[最终绿](foreign-expiry-green.log)；实际隔离对象存储验证不会把旧空间上传标过期 |
| 评审 | [Standards与Spec分轴记录](review.md)，标准0未解决；需求原1项P1已修复、复核通过 |
| Docker | [构建](docker-build.log)、[发布运行文件探测](release-runtime-probe.log)通过；无Argon2登录依赖，原认证模块不在新部署镜像 |
| 编译/SQL一致性 | [source-state.json](source-state.json)，实际部署16个编译/静态产物与宿主构建一致；001–038逐字不改 |

过程中失败日志保留，不计为通过：旧任务夹具缺默认映射、旧角色/用户断言、旧Cookie登录测试、历史不可变决策的测试构造和多状态DOM定位均按新要求修正；未通过关闭业务/请求守卫使测试变绿。请求令牌过期用Node测试内时钟模拟，不是改变主机时间或跨日RPO实测。

## 现有实例升级

[备份](backup.log)和[升级](local-upgrade.log)实际执行；[部署报告](local-upgrade.json)记录58张保留数据表的count/hash一致、默认workspace/user/member ID沿用、内部密钥不轮换、39迁移、旧session失效、三后台心跳正常。来源仍healthy、定时关闭、未暂停；未主动执行真实采集/模型调用。

首次备份在镜像清单步骤遇到旧解析器镜像索引被Docker清理：[失败记录](backup-first.log)，未迁移数据。BUG-036将镜像清单改为读取实际容器引用，重新备份并逐文件校验通过；失败备份目录保留。[清单失败/空列表自检](backup-inventory-selftest.json)仅使用合成Docker适配器，未操作真实服务。数据库dump、objects/state归档及密钥只在受限.local/backups，不入仓。

旧应用镜像保留为yoyo-local:before-change014-c993d0f；旧解析器容器快照保留为yoyo-media-local:before-change014-recovered，[独立PIL/沙箱检查](old-parser-recovery-check.json)通过。首次独立检查保留了容器启动入口，因未挂载token而失败，仅为探测方式错误；改用显式sh入口后通过，不宣称该失败是产品缺陷。

[实际空Cookie浏览器验证](local-browser.json)通过：直接工作台、无邮箱/密码/成员/退出入口、清Cookie仍可用、旧成员链接返回工作台。只读验证，没有修改真实业务数据。

当前yoyo-local网页3000/私有对象59001及原dev三依赖继续运行。新离线包/干净clone/HTTPS规模发布复验、跨日RPO与暂缓真实后台样本验收未在本轮完成；旧rc15包不变。
