# CHANGE-013：手动采集与定时开关独立

2026-10-25，Codex；目录 `/Users/junlong/projects/social-mdeida-ops-platform`，分支 `codex/s9-acceptance`，实现基线2508ea6加本轮修改。状态只在开发进度台账维护，本文件是验证证据。

## 结果

- enabled仅控制自动调度；关闭定时仍允许立即采集或验证，暂停时手动采集仍被拒绝，验证可恢复。全部触发共用单并发/最小间隔，权限及工作区检查保留。
- 调度开关与窗口变化不影响新建人工采集/验证任务的排队和结果提交。入队时记录实际来源输入摘要；来源配置、负责人、配额或暂停状态变化仍取消旧结果。旧版无摘要任务继续使用原保守版本检查，无数据库迁移。
- 定时开关不覆盖来源实际健康；页面明确区分定时开启/关闭，关闭时手动按钮可用，暂停原因及等待光标规则保留。旧disabled健康仅展示为待验证，不虚构健康或自动修改旧数据。

## 验证

| 检查 | 证据 |
|---|---|
| 先红后绿 | [collection-red.log](collection-red.log)：9项中6通过/3失败，覆盖旧手动409和开关变化取消人工任务；[collection-green.log](collection-green.log)：9/9通过；后补旧任务兼容检查包含在完整集成中 |
| 集成 | [integration.log](integration.log)：137/137通过，当前采集文件10例；[补旧任务用例前的136项](integration-before-legacy-check.log)保留 |
| 浏览器 | [browser.log](browser.log)：17/17通过，真实HTTP创建关闭定时来源并手动入队/复用，以及独立暂停提示、三导航/窄屏回归 |
| 构建与类型 | [build.log](build.log)、[typecheck.log](typecheck.log)，通过 |
| 契约 | [生成](contract-generation.log)/[清单](contract-manifest.json)/[校验](contract-validation.json)：75路径/90操作/125Schema、30样例通过；enabled描述与设计基线同步 |
| 源码Docker | [docker-build.log](docker-build.log)、[升级](local-upgrade.log)、[停写](local-stop-writers.log)：API/worker/media/scheduler均更新到本轮构建 |
| 运行与数据 | [local-runtime.json](local-runtime.json)：网页与健康200，前端资源匹配已测构建，四服务采集模块hash一致且三后台心跳晚于各自启动时间；38迁移不变；9张业务表count/hash与升级前一致，来源healthy/enabled=false/paused=false保持 |
| 一致备份 | [backup.json](backup.json)：database/objects/state在受限.local/backups目录，同点备份和SHA256校验通过；沿用此前源码浮动标签的只读tar载体方法，实际秘密不入仓 |

全部采集/AI回归使用明确合成数据与受控适配器，工具未发起新的真实来源或模型请求，未替用户开启定时或创建测试账号。本次实际使用库只备份与原样恢复服务；无新迁移、无业务数据改写。临时测试使用可重置yoyo_change012_test及隔离S8存储/解析器，结束后依赖停止且卷保留。

## 使用

刷新选题页面，定时关闭时直接点击“立即采集”；需要自动运行时再启用定时。暂停来源先验证恢复，频率限制触发时按实际错误等待，不用切定时开关规避限制。

当前yoyo-local七服务与原dev三依赖继续；原用户/成员/来源与50条线索/50份观察保留。新离线候选、HTTPS规模发布门禁、真实跨日RPO和暂缓后台数据未在本轮验收，不将本次范围完成当成首版完整发布。
