# S9候选交付证据

2026-10-11，执行者Codex；工作目录本项目，main/27016b1，修改未提交、未推送、未发布。状态事实以[台账](../../tracking/开发进度.md)为准。

## 已执行

- 当前候选0.1.0-s9rc10：[构建](release-build-rc10.log)、[316文件冻结校验](release-bundle-check-rc10.json)、[arm64加载](load-arm64-rc10.log)、[amd64加载](load-amd64-rc10.log)通过，包含037、本地OCR及已修复恢复入口。含037的rc9[原生arm64十项运行](runtime-arm64-rc9.log)通过，报告[runtime-arm64.json](runtime-arm64.json)明确对应rc9；rc10完成下述兼容切换，不称重复完整十项演练。
- 历史rc8：[构建](release-build-rc8.log)、[300文件冻结校验](release-bundle-check-rc8.json)、[arm64加载](load-arm64-rc8.log)、[amd64加载](load-amd64-rc8.log)、[arm64十项运行](runtime-arm64-rc8.log)通过。源码包含BUG-023文件鉴权修复，模板禁止将真实token写.env；固定digest缓存按平台/RepoDigest核对后复用。旧rc5报告保留于[runtime-arm64-rc5.json](runtime-arm64-rc5.json)。
- [Bridge实际集成](bridge-integration.json)：当前rc8容器读取0600凭据文件（环境TOKEN为空）、连到宿主loopback Bridge，匿名健康401/鉴权200且取得一条真实公开搜索结果。原始公开结果只在受限.local，不提供账号后台指标。[文件鉴权回归](bridge-auth-regression.log)及[来源14项观察日志](source-regression-observed.log)通过，后者只包含终端后段结果，RPC/状态用合成夹具；不称14类真实来源验收。首次失败见[bridge-auth-first-failure.log](bridge-auth-first-failure.log)。

## 历史候选检查

- 历史候选0.1.0-s9rc5：[构建](release-build-rc5.log)、[冻结源码校验](release-bundle-check.json)、[arm64加载](load-arm64-rc5.log)、[amd64加载](load-amd64-rc5.log)通过。冻结298个非私有源码文件，两架构从相同副本构建，逐文件/完整清单SHA256及与交付Compose/备份脚本一致性检查通过。[arm64运行报告](runtime-arm64-rc5.json)及[完整日志](runtime-arm64-rc5.log)十个检查点再次通过，只对应新隔离实例yoyo-s9-arm64-3。
- 固定版本候选0.1.0-s9rc3：Linux arm64/amd64 app、解析器和固定digest数据库/存储/Caddy离线包已构建，原生依赖加载及镜像架构检查通过；两包SHA256及加载后镜像ID一致。包及含秘密备份只保存在受限`.local/releases/`和`.local/s9-runtime-*`，不入仓。[构建](release-build-rc3.log)、[arm64加载](load-arm64.log)、[amd64加载](load-amd64.log)。
- [rc3 arm64运行报告](runtime-arm64-rc3.json)：新隔离实例、真实Compose/HTTPS/数据库/存储/沙箱运行，十个检查点通过，包括首次设置/36迁移、Secure会话、Origin、代理IP替换、邀请及责任移交、私有文件签名、任务池、重启重建保留凭据和幂等、一致备份及恢复原运行服务。全部业务输入合成，不代替真实后台OCR或S9-02全链路。
- CI保护守卫修正为专用yoyo_ci_test并显式ALLOW_TEST_RESET；通过实际保护入口运行API/权限/文件17项回归。[观察日志](ci-regression-observed.log)只保存本次终端返回的后段输出及通过结果，不称托管CI或完整初始构建日志。配置自检2项及类型检查通过，见相关日志。
- 环境盘点见[environment.json](environment.json)：数据库只读查询、配置只记录权限/启用模式，原历史数据未迁移/清除。临时Bridge实际测试后停止，恢复初始未监听状态；不能称全部来源已健康。

## 未通过与待补

amd64在arm64 Docker Desktop/QEMU运行时，导入文件校验任务三次失败，演练超时；[实际失败日志](runtime-amd64.log)保留。进一步直接调用安全沙箱复现`landlock required: Function not implemented`、退出125，说明模拟器不支持必需的Landlock。[rc5沙箱复现](amd64-sandbox-rc5.json)与[原日志](amd64-sandbox-rc5.log)结果相同。解析器安全拒绝运行；没有关闭沙箱或把模拟运行写成原生x86验收。仍需原生amd64、支持Landlock/seccomp的Linux内核完整复验。固定版本多架构包可加载不代表两个架构完整业务都通过。

首次候选缺init脚本、第二次候选拉取远端镜像EOF、首次arm64演练HTTPS重连socket hangup及rc4拉取Caddy认证EOF等失败保留；rc4构建期间增加S0工具，也不作为最终源码一致的验收候选。rc5冻结源码解决构建过程中工作文件变化的问题。rc6在固定PostgreSQL拉取等待期间主动终止（137），已有相同digest两架构缓存核对通过后改从缓存打包；不是验收通过的包。rc7仍含旧模板注释，当前模板由rc8起冻结。真实完整恢复/回滚、业务全链路、目标环境性能、浏览器发布验收和17项门禁尚未完成，下面的技术探索不替代这些条件。

操作入口见[发布与运行](../../operations/发布与运行.md)。原生x86目标环境、公网域名/证书、外部告警和值守人尚未提供；不得把本地测试写成公网上线。

## 本地性能技术探索

[性能报告](performance-local.json)及[窗口操作测量日志](performance-window-check.log)：合成1工作区/账号、5用户并发、1万线索/1千笔记/10万有效观察；7种列表/详情各50样本，p95最大约77ms，异步受理20样本p95约8ms。宿主Node/arm6410CPU24GiB＋本地Docker PostgreSQL，不是生产/目标Compose最低资源验收。三主界面加载和控件只有单次样本，不称页面p95；复盘数据明确限定7天，宽窗口1万条保护422保持。首次种子类型、测试Origin失败保留于performance-first/second/third.log。原库不变，独立性能库保留，不标S9-04 DONE或T24 PASS。

## 隔离恢复与兼容切换技术探索

- [恢复报告](recovery-verification.json)、[实际耗时](restore-timing.json)及[日志](restore-timed.log)：合成独立笔记/100与101两次指标修订/更正链/文件证据及system.check任务，真实Compose一致备份恢复到全新项目。37迁移、业务快照、凭据及TLS CA保持，登录后私有原件SHA通过；恢复到全部服务健康15035ms。没有备份后写入，未测日常备份RPO，不称真实业务恢复验收。
- [已有目标拒绝](restore-protection.json)及[损坏备份拒绝](restore-corruption-protection.json)通过；恢复入口检查校验和、归档路径/链接、项目所属空卷，失败停止新项目并保留现场。首次[网络耗尽](recovery-first.log)、[缺stdin](restore-second.log)、[存储空目录](restore-third.log)失败留存；修正后恢复成功。[网络清理](test-network-cleanup.json)仅释放8个已停止旧S9项目网络，全部容器/卷/备份保留。
- [兼容切换报告](compatible-rollback.json)及[日志](compatible-rollback.log)：先核对rc9与rc10应用编译内容逐字相同，再rc10→rc9→rc10重建，业务快照/37迁移不变。只是兼容构建切换，未降级数据库，不证明不兼容旧版本回滚。[类型检查](recovery-typecheck.log)通过。新恢复项目和源测试项目均已停止，持久卷保留。
- S9-01/S9-02原完成依赖、真实视频/账号身份、原生amd64、日常RPO及完整发布门禁仍缺；不能将这些技术证据设为S9-05 DONE或T23 PASS。

## 2026-10-12：目标Compose资源上限及恢复统计修复

[规模报告](performance-compose.json)、[完整测量日志](performance-compose-third.log)：固定rc10全新项目、实际inspect核对所有容器合计4 CPU/4.5GiB上限，37迁移/1万线索1千笔记10万观察，5用户。7种API各50样本p95最大625ms，20次异步受理p95约12ms；三主界面各10样本×1440/1280/390宽度，p95最大968ms。只测导航加载和可操作控件，不代替完整三宽度业务/键盘流程；宿主仍为原Docker Desktop，不称专用最低宿主或干净远端clone认证。

首次地址池耗尽日志performance-compose-first保留；只额外释放6个已停止旧S9项目网络，[清理记录](test-network-cleanup-second.json)，全部容器/卷保留。第二次恢复后缺统计，工作台查询8–15秒、并发57014超时，[失败报告](performance-compose-before-analyze.json)及performance-compose-second日志保留。精确同查询ANALYZE前后由错误估算的Nested Loop Anti Join变为Hash Anti Join，计划和空统计在成功报告内。BUG-027修复restore.sh：pg_restore后先ANALYZE再启动应用；[新项目实际恢复验证](restore-analyze-validation.json)两业务表统计确认通过。BUG-028拒绝无项目标签的同名已有空卷，[保护检验](restore-volume-collision.json)没有创建目标容器/其他卷，原空卷保持。脚本语法及[类型检查](identity-typecheck.log)通过。

稳定真实账号身份已在[S0](../s0/backend-identity.json)核验，原两类截图当前产品复验通过；视频仍缺，完整S9硬依赖不改。新项目全部停止，原开发服务与库不改；新恢复脚本需下一固定候选，rc10历史包未重写。
