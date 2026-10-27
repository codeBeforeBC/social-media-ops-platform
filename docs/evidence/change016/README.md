# CHANGE-016：微博来源卡片精简

2026-10-27；Codex；目录`/Users/junlong/projects/social-mdeida-ops-platform`，分支`codex/s9-acceptance`，HEAD`9ae84f7`；在CHANGE-015未提交修改上继续，本轮也未提交/推送。关联S1-07，LOG-117开工、LOG-118交接；CHANGE-015原始证据保留，以下为新显示要求。

## 修改与依据

当前微博热搜采集器固定`summary=''`、`published_at=null`、`date_label_raw=null`，能力标记`read_detail=false`、`published_time_available=false`（`packages/domain/src/source-adapters.ts`）；这是当前接入的能力，不推断微博平台的其他接口。

- 微博卡片不显示摘要区域或空正文提示，仅保留标题与现有来源/采集信息；发布时间不显示，采集时间保留。
- 微博详情及观察记录不显示空正文提示，详情隐藏缺失发布时间和原始日期标记；已有历史摘要仍在详情保留。
- 所有来源卡片的“查看来源与观察记录”按钮改为“详情”。小红书的摘要/空正文说明、已提供或缺失的发布时间保持。
- 未改变采集逻辑、数据库或来源配置；CHANGE-015运行记录表格保留。

## 验证

| 检查 | 证据与范围 |
|---|---|
| 前端构建 / 全项目类型 | [build.log](build.log)、[typecheck.log](typecheck.log)通过 |
| 相关浏览器回归 | [browser.log](browser.log)，5/5通过。使用隔离yoyo_change014_test和合成记录，覆盖微博无提示/无发布日期/详情按钮，原始观察/历史摘要仍可读取，小红书空与已有摘要/缺失与真实日期保留；来源操作、进度轮询/读失败恢复、运行记录表格回归 |
| Docker及更新 | [docker-build.log](docker-build.log)完整构建通过，[local-upgrade.log](local-upgrade.log)只以no-deps更新API容器；无迁移，旧API镜像保留yoyo-local:change016-rollback |
| 本地实态 | [local-runtime.json](local-runtime.json)、[local-verify.log](local-verify.log)：提供的JS/CSS匹配已测构建，39迁移/58业务表count和hash/默认身份保持；原来源healthy/定时关闭/未暂停，原最新成功50条保持 |
| 实际浏览器 | [local-browser.json](local-browser.json)、[local-browser.log](local-browser.log)：空Cookie只读核对卡片/详情不显示微博缺失提示与发布时间，“详情”按钮可用，八列运行记录及窄屏键盘横滚通过；0写请求/0页面错误；[实际卡片](screenshots/local-card.png)、[运行记录桌面](screenshots/local-runs-1440.png)、[运行记录窄屏](screenshots/local-runs-390.png) |
| 文档 / 差异 | [document-check.log](document-check.log)：69任务状态统计、依赖、链接、git diff --check |

未重跑全量后台集成/全部浏览器测试，未新增真实来源或模型请求，未生成新数据库备份/离线交付包；原受限备份与发布门禁保留。yoyo-local七服务继续运行，临时S8两测试依赖停止且保留卷，原dev依赖保持。下一条刷新本地选题页查看精简卡片；S9-05跨日RPO及暂缓后台数据仍待原条件。
