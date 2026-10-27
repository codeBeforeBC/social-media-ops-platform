# CHANGE-015：来源提示与运行记录表格

2026-10-27；Codex；目录`/Users/junlong/projects/social-mdeida-ops-platform`，分支`codex/s9-acceptance`，基线`9ae84f7`，本轮修改未提交。关联S1-07，开工LOG-115，交付LOG-116。

## 交付范围

- 微博无摘要时显示“已采集热搜标题与热度，当前来源不提供正文。”；小红书显示“已保存来源标题，本次未获取正文或摘要，可打开原始来源查看。”；卡片、来源证据、单次观察提示一致，已有摘要保留。
- 来源连接的运行记录改为表格：状态、触发方式、提交时间、开始时间、完成时间、排队用时、采集耗时、结果与说明。采集器版本、警告和错误代码保留；继续自动轮询、终态停止与读失败恢复；日期按Asia/Shanghai显示。
- 运行记录抽屉加宽；窄屏在表格内部横向滚动，滚动区可键盘聚焦，表头具有列语义。未修改采集器、后端接口、数据结构、来源配置或定时行为。

## 验证证据

| 检查 | 结果及证据 |
|---|---|
| 前端构建 / 全项目类型 | [build.log](build.log)、[typecheck.log](typecheck.log)通过；Docker构建也执行完整项目build |
| 相关浏览器回归 | [browser.log](browser.log)，5/5通过：来源配置/同源记录、排队→运行→完成及读失败恢复、定时与暂停、来源详情、三类摘要展示分支。增加多行部分完成/取消、触发方式、版本/警告、表头和窄屏检查；使用可重置yoyo_change014_test、隔离存储与合成记录，不代表新真实采集成功 |
| 视觉检查 | [桌面合成记录](screenshots/collection-runs-1440.png)、[窄屏合成记录](screenshots/collection-runs-390.png)；查看截图确认表格布局与窄屏滚动 |
| 本地更新 | [Docker构建](docker-build.log)、[API容器更新](local-upgrade.log)，只重建承载静态页面的API容器，使用no-deps，不执行迁移/重建数据库；旧API镜像保留本机yoyo-local:change015-rollback |
| 运行实态 / 数据保留 | [local-runtime.json](local-runtime.json)、[local-verify.log](local-verify.log)：39迁移、58业务表count/hash、默认身份保持；提供的JS/CSS与已测构建一致；原来源healthy/定时关闭/未暂停、最新任务成功50条 |
| 实际只读浏览器 | [local-browser.json](local-browser.json)：空Cookie打开真实本地实例，卡片/详情文案、八列表格、真实成功50条、390宽度键盘横向滚动通过，0页面错误/0写请求；[实际桌面](screenshots/local-runs-1440.png)、[实际窄屏](screenshots/local-runs-390.png) |
| 文档与差异 | [document-check.log](document-check.log)：69任务状态统计、依赖/链接和git diff --check；不冒充产品测试 |

本轮仅展示调整，未发起真实来源或模型请求；未重复全量后端集成/全部浏览器测试，未交付新离线包或关闭发布门禁。未生成新数据库/文件备份；此轮不修改业务数据/迁移，已有受限备份保留，更新前后只读核对58表及身份。

yoyo-local七服务继续运行；测试S8两服务停止且保留卷，原dev依赖保留。下一步刷新本地选题页，打开来源连接的运行记录验收；S9-05跨日RPO与暂缓后台数据缺口保持。
