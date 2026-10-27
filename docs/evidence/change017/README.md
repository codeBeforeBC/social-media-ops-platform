# CHANGE-017：移除卡片重复详情按钮

2026-10-27；Codex；`/Users/junlong/projects/social-mdeida-ops-platform`，`codex/s9-acceptance/9ae84f7`。保留CHANGE-015/016未提交修改，本轮也未提交/推送；关联S1-07，LOG-119开工，LOG-120交接。

仅删除来源卡片底部的“详情”按钮，标题仍为原生按钮，鼠标点击或聚焦后回车可打开来源证据；未更改请求、采集行为或元数据。`weibo-hot`为来源连接的名称，`正常`来自连接当前health=healthy的展示映射，不表示内容已核实；代码依据`packages/domain/src/source-evidence.ts`的connection_name/connection_health查询及`apps/web/src/sources.tsx`渲染。

- [前端构建](build.log)、[全项目类型](typecheck.log)、[完整Docker构建](docker-build.log)通过。
- [3项相关浏览器检查](browser.log)通过：来源配置与记录、原始观察详情、微博/小红书标题入口及键盘回车、每张卡片仅一个标题按钮。使用隔离测试数据库/存储与合成记录，不当作真实采集证据。
- [本地更新](local-upgrade.log)仅no-deps更新API，无迁移；[运行检查](local-runtime.json)确认JS/CSS匹配已测构建，39迁移/58业务表count和hash/默认身份保持，原来源healthy/定时关闭/未暂停/最新成功50条保持。
- [真实只读浏览器](local-browser.json)确认按钮移除、标题打开详情、原精简文案及八列运行记录/窄屏键盘滚动保持；0写请求、0页面错误、无新增真实来源/模型请求。[实际卡片](screenshots/local-card.png)。
- [文档检查](document-check.log)覆盖69任务统计、依赖、链接与git diff --check。原CHANGE-015/016证据保留。

未重跑全量后台集成/全部浏览器，未新增数据备份或离线包；旧API镜像本机保留yoyo-local:change017-rollback，原受限备份保留。yoyo-local七服务继续、S8测试两服务停止并保留卷、原dev依赖保持。本次无遗留，下一条刷新本地选题页通过标题查看详情；S9-05跨日RPO/暂缓后台数据与完整发布门禁保持。
