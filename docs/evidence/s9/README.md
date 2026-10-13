# S9候选交付证据

> 2026-10-13 · [CHANGE-009 / ADR-009](../../decisions/ADR-009-仅支持arm64容器交付.md)：当前支持范围仅linux/arm64。下文历史双架构构建/加载及amd64失败记录保留，不定义当前支持承诺或复验待办；构建/加载/发布Compose/冒烟入口已收口为arm64，当前实现与检查见下方rc13证据；完整任务状态仍只见台账。

当前候选rc12：[333文件冻结校验](release-bundle-check-rc12.json)、[arm64加载](load-arm64-rc12.log)及[页面演练](release-ui.json)。rc12既有双架构包不改写；rc13已完成仅arm64新构建；rc12保留历史。

2026-10-12，执行者Codex；工作目录本项目，当前codex/s9-acceptance，实现6d08fab、候选冻结3251929；main/origin/main仍27016b1，未推送、未发布。下述历史候选对应当时main上的未提交工作，状态事实以[台账](../../tracking/开发进度.md)为准。

## 已执行

- 历史候选0.1.0-s9rc11：[构建](release-build-rc11.log)、[319文件冻结校验](release-bundle-check-rc11.json)、[arm64加载](load-arm64-rc11.log)、[amd64加载](load-amd64-rc11.log)通过，包含037、本地OCR、恢复ANALYZE及无标签同名卷保护。历史rc10：[构建](release-build-rc10.log)、[316文件冻结校验](release-bundle-check-rc10.json)、[arm64加载](load-arm64-rc10.log)、[amd64加载](load-amd64-rc10.log)保留。含037的rc9[原生arm64十项运行](runtime-arm64-rc9.log)通过，报告[runtime-arm64.json](runtime-arm64.json)明确对应rc9；rc10完成下述兼容切换，不称重复完整十项演练。
- 历史rc8：[构建](release-build-rc8.log)、[300文件冻结校验](release-bundle-check-rc8.json)、[arm64加载](load-arm64-rc8.log)、[amd64加载](load-amd64-rc8.log)、[arm64十项运行](runtime-arm64-rc8.log)通过。源码包含BUG-023文件鉴权修复，模板禁止将真实token写.env；固定digest缓存按平台/RepoDigest核对后复用。旧rc5报告保留于[runtime-arm64-rc5.json](runtime-arm64-rc5.json)。
- [Bridge实际集成](bridge-integration.json)：当前rc8容器读取0600凭据文件（环境TOKEN为空）、连到宿主loopback Bridge，匿名健康401/鉴权200且取得一条真实公开搜索结果。原始公开结果只在受限.local，不提供账号后台指标。[文件鉴权回归](bridge-auth-regression.log)及[来源14项观察日志](source-regression-observed.log)通过，后者只包含终端后段结果，RPC/状态用合成夹具；不称14类真实来源验收。首次失败见[bridge-auth-first-failure.log](bridge-auth-first-failure.log)。

## 历史候选检查

- 历史候选0.1.0-s9rc5：[构建](release-build-rc5.log)、[冻结源码校验](release-bundle-check.json)、[arm64加载](load-arm64-rc5.log)、[amd64加载](load-amd64-rc5.log)通过。冻结298个非私有源码文件，两架构从相同副本构建，逐文件/完整清单SHA256及与交付Compose/备份脚本一致性检查通过。[arm64运行报告](runtime-arm64-rc5.json)及[完整日志](runtime-arm64-rc5.log)十个检查点再次通过，只对应新隔离实例yoyo-s9-arm64-3。
- 固定版本候选0.1.0-s9rc3：Linux arm64/amd64 app、解析器和固定digest数据库/存储/Caddy离线包已构建，原生依赖加载及镜像架构检查通过；两包SHA256及加载后镜像ID一致。包及含秘密备份只保存在受限`.local/releases/`和`.local/s9-runtime-*`，不入仓。[构建](release-build-rc3.log)、[arm64加载](load-arm64.log)、[amd64加载](load-amd64.log)。
- [rc3 arm64运行报告](runtime-arm64-rc3.json)：新隔离实例、真实Compose/HTTPS/数据库/存储/沙箱运行，十个检查点通过，包括首次设置/36迁移、Secure会话、Origin、代理IP替换、邀请及责任移交、私有文件签名、任务池、重启重建保留凭据和幂等、一致备份及恢复原运行服务。全部业务输入合成，不代替真实后台OCR或S9-02全链路。
- CI保护守卫修正为专用yoyo_ci_test并显式ALLOW_TEST_RESET；通过实际保护入口运行API/权限/文件17项回归。[观察日志](ci-regression-observed.log)只保存本次终端返回的后段输出及通过结果，不称托管CI或完整初始构建日志。配置自检2项及类型检查通过，见相关日志。
- 环境盘点见[environment.json](environment.json)：数据库只读查询、配置只记录权限/启用模式，原历史数据未迁移/清除。临时Bridge实际测试后停止，恢复初始未监听状态；不能称全部来源已健康。

## 历史未通过与当前待补

amd64在arm64 Docker Desktop/QEMU运行时，导入文件校验任务三次失败，演练超时；[实际失败日志](runtime-amd64.log)保留。进一步直接调用安全沙箱复现`landlock required: Function not implemented`、退出125，说明模拟器不支持必需的Landlock。[rc5沙箱复现](amd64-sandbox-rc5.json)与[原日志](amd64-sandbox-rc5.log)结果相同。解析器安全拒绝运行；没有关闭沙箱或把模拟运行写成原生x86验收。该amd64复验要求已由CHANGE-009取消，不再是当前待办；arm64目标仍须支持Landlock/seccomp。固定版本多架构包可加载不代表两个架构完整业务都通过。

首次候选缺init脚本、第二次候选拉取远端镜像EOF、首次arm64演练HTTPS重连socket hangup及rc4拉取Caddy认证EOF等失败保留；rc4构建期间增加S0工具，也不作为最终源码一致的验收候选。rc5冻结源码解决构建过程中工作文件变化的问题。rc6在固定PostgreSQL拉取等待期间主动终止（137），已有相同digest两架构缓存核对通过后改从缓存打包；不是验收通过的包。rc7仍含旧模板注释，当前模板由rc8起冻结。真实完整恢复/回滚、业务全链路、目标环境性能、浏览器发布验收和17项门禁尚未完成，下面的技术探索不替代这些条件。

操作入口见[发布与运行](../../operations/发布与运行.md)。amd64/x86目标环境已取消；公网域名/证书、外部告警和值守人尚未提供；不得把本地测试写成公网上线。

## 本地性能技术探索

[性能报告](performance-local.json)及[窗口操作测量日志](performance-window-check.log)：合成1工作区/账号、5用户并发、1万线索/1千笔记/10万有效观察；7种列表/详情各50样本，p95最大约77ms，异步受理20样本p95约8ms。宿主Node/arm6410CPU24GiB＋本地Docker PostgreSQL，不是生产/目标Compose最低资源验收。三主界面加载和控件只有单次样本，不称页面p95；复盘数据明确限定7天，宽窗口1万条保护422保持。首次种子类型、测试Origin失败保留于performance-first/second/third.log。原库不变，独立性能库保留，不标S9-04 DONE或T24 PASS。

## 隔离恢复与兼容切换技术探索

- [恢复报告](recovery-verification.json)、[实际耗时](restore-timing.json)及[日志](restore-timed.log)：合成独立笔记/100与101两次指标修订/更正链/文件证据及system.check任务，真实Compose一致备份恢复到全新项目。37迁移、业务快照、凭据及TLS CA保持，登录后私有原件SHA通过；恢复到全部服务健康15035ms。没有备份后写入，未测日常备份RPO，不称真实业务恢复验收。
- [已有目标拒绝](restore-protection.json)及[损坏备份拒绝](restore-corruption-protection.json)通过；恢复入口检查校验和、归档路径/链接、项目所属空卷，失败停止新项目并保留现场。首次[网络耗尽](recovery-first.log)、[缺stdin](restore-second.log)、[存储空目录](restore-third.log)失败留存；修正后恢复成功。[网络清理](test-network-cleanup.json)仅释放8个已停止旧S9项目网络，全部容器/卷/备份保留。
- [兼容切换报告](compatible-rollback.json)及[日志](compatible-rollback.log)：先核对rc9与rc10应用编译内容逐字相同，再rc10→rc9→rc10重建，业务快照/37迁移不变。只是兼容构建切换，未降级数据库，不证明不兼容旧版本回滚。[类型检查](recovery-typecheck.log)通过。新恢复项目和源测试项目均已停止，持久卷保留。
- S9-01/S9-02原完成依赖、真实视频/账号身份、日常RPO及完整发布门禁仍缺；不能将这些技术证据设为S9-05 DONE或T23 PASS。

## 2026-10-12：目标Compose资源上限及恢复统计修复

[规模报告](performance-compose.json)、[完整测量日志](performance-compose-third.log)：固定rc10全新项目、实际inspect核对所有容器合计4 CPU/4.5GiB上限，37迁移/1万线索1千笔记10万观察，5用户。7种API各50样本p95最大625ms，20次异步受理p95约12ms；三主界面各10样本×1440/1280/390宽度，p95最大968ms。只测导航加载和可操作控件，不代替完整三宽度业务/键盘流程；宿主仍为原Docker Desktop，不称专用最低宿主或干净远端clone认证。

首次地址池耗尽日志performance-compose-first保留；只额外释放6个已停止旧S9项目网络，[清理记录](test-network-cleanup-second.json)，全部容器/卷保留。第二次恢复后缺统计，工作台查询8–15秒、并发57014超时，[失败报告](performance-compose-before-analyze.json)及performance-compose-second日志保留。精确同查询ANALYZE前后由错误估算的Nested Loop Anti Join变为Hash Anti Join，计划和空统计在成功报告内。BUG-027修复restore.sh：pg_restore后先ANALYZE再启动应用；[新项目实际恢复验证](restore-analyze-validation.json)两业务表统计确认通过。BUG-028拒绝无项目标签的同名已有空卷，[保护检验](restore-volume-collision.json)没有创建目标容器/其他卷，原空卷保持。脚本语法及[类型检查](identity-typecheck.log)通过。

稳定真实账号身份已在[S0](../s0/backend-identity.json)核验，原两类截图当前产品复验通过；视频仍缺，完整S9硬依赖不改。新项目全部停止，原开发服务与库不改；新恢复脚本已固定在rc11，rc10历史包未重写。

## 干净本地clone与浏览器首次设置

[报告](clean-clone-runtime.json)及[日志](clean-clone-runtime.log)：实际git clone --no-hardlinks取得候选同一提交3251929，初始无.local/node_modules且工作树干净，逐文件SHA与319文件冻结清单一致。固定rc11/arm64，Compose新项目/空卷37迁移，11.752秒至服务健康，浏览器首次管理员设置387ms及三导航/1440、1280、390真空态无页面错误/宽度溢出。产品服务没有宿主Node/pnpm或应用源码挂载；证书校验忽略仅属于浏览器测试上下文，未修改产品TLS/宿主信任。使用现有Docker缓存和本地Git来源，不称干净宿主、远端镜像下载或原生amd64验收。

[第三次网络释放记录](test-network-cleanup-third.json)仅3个已停止旧失败性能项目网络，所有容器/卷保留；clone测试项目停止。最新[盘点](environment.json)记录各库与私有配置脱敏实态，原库/AI不改，原dev三依赖继续。当前本地交付不是完整S9发布；真实视频和全门禁/运行责任仍待补。

## 2026-10-12：实际来源、模型与A/B/C演练

- [三类真实来源](real-sources.json)、[日志](real-sources-first.log)：rc11 HTTPS/API/worker实际采集微博热点、小红书热点信号和优质笔记各1条，优质笔记详情正文可读。Bridge使用600文件token，公开原文和完整响应只在受限.local，仓库留范围/时间/哈希；小红书信号为搜索非官方榜。临时Bridge停止。T03 PASS只覆盖该单项。
- [真实A](acceptance-real-A.json)、[只读恢复用量日志](acceptance-real-A-recovery.log)：真实提供方选题/人工幂等采纳，已核验账号及既有2023图文登记、授权账号和图文原件经rc11本地OCR/人工选区/确认、真实提供方partial报告通过。不是新平台发帖，也不宣称老帖由本次选题生成。两次DeepSeek-flash成功、总21472 token，费用未知而非零，分别yoyo-v1.2.4/ai-topics-v1.2与yoyo-report-v1.0.3/ai-report-v1；仍缺视频，complete_S9_02_acceptance=false。
- 首次[A日志](acceptance-real-A-first.log)在已完成业务后用量查询误用列，清理被中断。立即停worker并核对hash删除本次临时配置；BUG-029改usage列及嵌套清理，[3项异常自检](evidence-cleanup-tests.log)通过。只读实际状态/私有捕获重建证据，恢复没有付费请求。配置删除和服务停止有实际复核，原产品/评估配置保持。模型只收到文本/程序计算，没有原图。
- [B报告](acceptance-B.json)、[通过日志](acceptance-B-fourth.log)：合成9行数据的部分确认/去重、程序31、报告stale/策略人工激活与退役、更正后撤销旧批次/缺期初重算partial、许可撤回缓存/无发送及取消端点8项。编译处理器用模拟模型传输，一般worker暂停，临时虚构key配置删除；无真实模型请求。字段名/AI默认未配置/缺派生输入的失败报告日志保留。
- [C报告](acceptance-C.json)、[日志](acceptance-C-second.log)：原yoyo_test26只读备份还原到新数据库，rc11编译迁移37两次、所有原表数量与笔记/文件身份保持，原库前后同快照；编译scheduler真实循环排队一次、6种退出任务拒绝、缺浏览器BROWSER_UNAVAILABLE不清来源历史。没有恢复原5份旧对象，不称完整C。首次错误码期望失败保留。
- [真实XLSX导出/首表映射](../s0/backend-export.json)、[日志](real-export-second.log)：现有授权账号实际下载7787字节/7表，当前HTTP/沙箱首表12行，人工确认账号曝光1行/11行未确认；6趋势页未导入，原件SHA保持。账号混合观看/平均时长及完播率不硬套某视频，页面暂无数据和原值0.0差异保留；仍缺视频。数据字典不扩展来假装全部字段已支持。

## 安全技术验收

[10项报告](acceptance-security.json)及[日志](acceptance-security-second.log)：实际rc11 HTTPS角色/跨空间账号/私有签名、内网/元数据/脚本/带凭据URL、大小/MIME/旧purpose，实际原生Landlock沙箱隔离伪造PNG/公式CSV/XLSX/宏；反馈指令保留为数据，无发送。编译网关零预算/未知费用币种/预取消与模拟伪造输出两次修复拒绝，HTTP取消在处理器返回后提交前，无通知/结果副作用。无真实模型调用，原S9-02硬依赖未关闭。

首次重用未知费用工作区时正确触发币种守卫，夹具拆分后分别验证预算与币种，失败保留。登录配额只在已核验项目标签/自有卷的合成实例重置，不动原库。类型检查及语法通过；原有整套128不因诊断工具增加而无理由重跑。

## 实际旧版与真实A恢复

- [旧版镜像](rollback-baseline-build.log)、[实际回滚](baseline-rollback.json)、[日志](baseline-rollback-first.log)：从27016b1 Git archive构建实际旧arm64应用，在新项目36迁移建立合成笔记/600指标/原件/完成任务并一致备份；rc11升级37新增650修订；新项目恢复旧36备份点，15556ms到健康，业务/凭据/CA同点，旧API登录/笔记/指标/原件SHA与旧worker新诊断成功。650→600是明确丢失的备份后合成变更，不恢复使用实例。此前相同代码构建切换证据只保留其局部范围。
- [实际A恢复](restore-real-state.json)、[日志](restore-real-state-third.log)：当前实际3来源、2真实模型输出、授权身份/图文原件/指标，加其他明确合成测试行，在新项目37恢复15422ms至健康，25表关系hash/凭据/CA同点，真实两原件SHA和指标/登录保持，无新增模型调用、无临时AI配置。日常RPO仍未实测。
- 复合主键排序/地址池耗尽失败报告和日志保留；[第四次](test-network-cleanup-fourth.json)/[第五次](test-network-cleanup-fifth.json)各只释放4个已停止旧S9网络，所有容器/卷保留。全部临时服务停止，原dev三依赖继续。

## 门禁和交接

[派生门禁](release-gates.json)、[检查日志](release-gate-scan.log)从唯一台账读取8P0/17T/必要任务/重要缺陷与链接，当前10T PASS/7未闭、8前置未DONE、重要缺陷0，结果not_ready。它不是业务重测，不增加S9-06自身依赖。操作及解除条件见[验收与交接](../../operations/验收与交接.md)。真实视频、受支持arm64目标环境/脚本收口及最低环境/每日RPO和完整原依赖仍需验收；amd64环境已取消，不再阻塞。当前任务状态只见唯一台账，未公开发布。

本段新增工具测试的是不变rc11包；业务源码没有再次改动，诊断源码及证据的后续提交不改写3251929/319文件冻结清单。

## CHANGE-009仅arm64交付实现（2026-10-13）

- rc13：[构建](release-build-rc13.log)、[335文件冻结及唯一平台清单](release-bundle-check-rc13.json)、[arm64加载](load-arm64-rc13.log)、[3项交付回归](arm64-release-check.log)通过；无amd64归档。Compose固定arm64镜像/platform，加载/冒烟拒绝非arm64，既有YOYO_ARCH环境不能使Compose选回amd64。
- [原生arm64运行](runtime-arm64-rc13.json)及[日志](runtime-arm64-rc13.log)：新项目/空卷37迁移、可信CA HTTPS/Secure会话/Origin、多人移交、私有原件SHA/签名/实际沙箱、任务/通知、停启重建保留会话/幂等/凭据、一致备份与服务恢复、备份拒绝覆盖及日志无Cookie/签名共10检查点通过。合成输入，不代替真实视频或S9-02。
- 原runtime-arm64报告已归档[此前候选报告](runtime-arm64-before-rc13.json)，未改写历史失败。新候选实例停止/卷与私有备份保留，原dev三依赖继续。
