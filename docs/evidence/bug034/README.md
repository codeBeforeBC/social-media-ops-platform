# BUG-034：来源禁用按钮误显示等待状态

Codex；目录 `/Users/junlong/projects/social-mdeida-ops-platform`，分支 `codex/s9-acceptance`，实现基线55ee584。2026-10-21定位/修复/测试并更新本地API；2026-10-25续接完成当前实例与数据保留核验。本轮不启用用户来源、不发起真实采集或模型调用。

## 根因与修复

来源最近验证成功、50条线索已入库、没有待执行任务，但enabled=false使“立即采集”按既有规则不可用；通用button:disabled却使用cursor:wait，且页面未解释原因。[脱敏诊断](diagnosis.json)记录状态；不是采集任务持续运行。

只修改 `apps/web/src/style.css` 和 `apps/web/src/sources.tsx`：禁用光标改为not-allowed，真实请求等待由aria-busy单独表示；为未启用/已暂停来源显示对应原因，并用aria-describedby关联按钮。保留原启用/暂停、限流、定时及手工采集守卫，不自动开启定时。

## 验证

- [浏览器红测](browser-red.log)：3项中2通过，新增用例实际观测disabled按钮cursor=wait而失败；[定向绿测](browser-green.log)3/3通过，覆盖未启用/已暂停原因及可访问描述。
- [完整浏览器](browser.log)17/17、[完整集成](integration.log)134/134、[构建](build.log)/[类型](typecheck.log)通过，执行于2026-10-21。首轮测试依赖未启动导致服务无法启动的记录单列[环境日志](browser-environment-before.log)，不作为红测证据。
- [Docker构建](docker-build.log)及[本地API更新](local-upgrade.log)通过。只重建API，其他业务进程保持原版本；本次没有后端或迁移修改。
- [2026-10-25实际实例](local-runtime.json)：健康正常、JS/CSS与已测试本地构建匹配，包含禁用/暂停原因和not-allowed光标；38迁移保持。用户/成员/来源等7张表的行数和哈希与升级前一致；50条线索及50份来源观察保留，来源healthy/enabled=false/paused=false。

## 数据与运行交接

先在受限.local/backups目录完成数据库、objects与state同点备份并校验SHA256，[脱敏备份报告](backup.json)只保留路径/数量/hash，不包含密码、Cookie或用户原文。原Compose备份入口因浮动标签重建后的旧镜像索引不可inspect而在停止服务前退出；本次以已验证的新镜像仅作只读tar载体，并记录实际容器镜像ID，完成相同同点备份。未修改通用备份工具，备份及初次空失败目录均保留。

本地yoyo-local七服务、原dev三依赖继续运行；临时S8测试依赖已停止且卷保留。使用者刷新页面后，可按页面提示自行启用定时或验证恢复；本轮不改变用户来源配置。完整发布与跨日RPO、暂缓真实后台数据验收不在本BUG完成范围。
