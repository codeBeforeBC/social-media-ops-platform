# BUG-037：采集任务状态和进度反馈

Codex；目录 `/Users/junlong/projects/social-mdeida-ops-platform`，分支 `codex/s9-acceptance`，基线74eaa3d，保留已实现的CHANGE-014免登录模式。2026-10-26诊断/实现/回归/部署，2026-10-27补齐交接；最终提交通过LOG-114/Git定位。

## 原因与结果

实际手动采集Run/Job已成功：2026-10-26T15:26:47Z提交、15:26:50Z完成，约2.5秒返回50条。界面只保存提交notice，来源列表没有最新运行摘要；运行记录需手动打开且不自动更新，因而看不到后续状态。不是后台任务持续排队。

- 列表提供可空latest_run轻量摘要，仅含状态、触发方式、时间、条数和错误；按现有workspace/connection索引选取最新记录，不在列表返回大字段coverage/warnings。
- 采集/验证提交后自动打开运行记录，使用POST返回的真实Run立即展示初始状态。排队/运行时持续读取，状态读取失败提示并自动重试；终态停止高频轮询，关闭面板清理计时器并忽略过期响应。
- 显示真实提交/开始/结束时间及排队/运行用时，结束显示条数或失败代码；不编造百分比、队列名次或进行中条数。提交提示改为请求已提交，避免长期误报仍在排队。
- 关闭面板或刷新页面，来源列表仍按周期展示最新状态；成功后按当前筛选刷新已采集线索。原定时/手动/暂停/频率及默认实例边界保持，没有新采集调用。

## 验证

| 检查 | 证据 |
|---|---|
| API先红后绿 | [collection-red.log](collection-red.log)实际缺少latest_run而失败；[collection-green.log](collection-green.log)通过，真实PostgreSQL/HTTP/任务处理覆盖null→queued→running→succeeded及最新failed，确认列表不含大字段 |
| UI先红后绿 | [browser-red.log](browser-red.log)以旧Sources组件构建、新后端运行，提交后无自动面板而失败；[browser-green.log](browser-green.log)通过，受控状态验证排队→运行→完成50条、刷新摘要、终态停止轮询、503恢复及失败原因；红测只临时更换宿主构建，未部署旧组件 |
| 完整回归 | [integration.log](integration.log)143/143；[browser.log](browser.log)17/17。均使用可重置yoyo_change014_test及隔离测试存储/解析器，无真实来源或模型调用 |
| 构建/类型 | [build.log](build.log)、[typecheck.log](typecheck.log)通过 |
| 契约 | [生成](contract-generation.log)/[清单](contract-manifest.json)/[校验](contract-validation.json)：67路径/80操作/119Schema、25样例通过，最新摘要与交互说明同步 |
| 实例更新 | [Docker构建](docker-build.log)、[更新](local-upgrade.log)、[部署核验](local-runtime.json)：API模块和所提供JS与已测试构建一致，39迁移不变，58张保留业务表count/hash和默认实例身份均保持；来源仍healthy/定时关闭/未暂停，最新manual记录成功50条 |
| 实际浏览器 | [local-browser.json](local-browser.json)：无Cookie打开现有实例，最新完成摘要及历史排队/开始/完成时间显示正常，无Invalid Date/NaN、无页面错误，0写请求，未触发采集 |
| 一致备份 | [backup.json](backup.json)、[日志](backup.log)：database/objects/state同点备份在受限.local/backups，校验通过；不包含秘密或用户原文的公开副本 |

新功能只更新API镜像；备份停写后恢复原业务进程，worker/调度逻辑无修改。yoyo-local七服务及原dev三依赖继续，临时S8测试依赖停止且卷保留。没有新增迁移、账号/来源配置改写或真实采集。新离线候选/HTTPS规模、跨日RPO及暂缓后台数据不在本BUG完成范围。
