# S8 复盘、反馈与工作台验收证据

执行者Codex，2026-10-10（Asia/Shanghai），目录`/Users/junlong/projects/social-mdeida-ops-platform`，分支`codex/s8-review-loop`，基线369b1c9。任务状态唯一入口为[开发进度](../../tracking/开发进度.md)。本轮使用隔离`yoyo_s8_dev/test`与对象/解析服务59090/59100，保留原库和全部持久卷，不推送或部署。业务值为明确合成夹具，真实HTTP/PostgreSQL/S3/沙箱与真实提供方调用须分别标识。

## S8-01 已验收产物与检查

- 指标API `apps/api/src/metrics.ts` / 领域 `packages/domain/src/metrics.ts` / 页面 `apps/web/src/metrics.tsx`：分析窗口、形式、流量过滤；按指标/统计类型/平台定义/定义版本/精度/窗口分组，显示实际时点和发布后时长。无数据或单快照不生成趋势，缺失不填零，未知与零区分；图文/视频均来自独立Publication，无活动维度。
- 原指标溯源和程序计算保留；列表半开窗口与计算期末边界分离。033迁移使失效计算可在保留旧ID/事实的条件下重新计算；仅当前指纹唯一。BUG-019回归包含发布时间更正并恢复原值后的新有效计算。
- `tests/analytics.test.ts`验证空态、非法窗口、取消字段、跨账号权限、未确认数据隔离、形式/流量/口径、发布年龄、约数/缺失、期末快照和历史重算；浏览器S8用例验证真实API+页面筛选、原始来源、1440/1280/390与键盘焦点。
- 中间日志 `initial-check.log`（缺Python环境）、`s8-01-integration.log`（夹具未选organic计算）、`s8-01-check.log`（浏览器登录等待竞争）保留，均不作为最终通过证据。最终[99项集成/构建/类型](s8-01-final-check.log)通过；该日志的原八项浏览器通过，新增浏览器经登录等待与选择器修正后[独立2项验证](s8-01-browser-final.log)通过，合计9条不同浏览器流程。加强后的112定义/68路径/82操作/[26样例](contract-validation.json)通过，[最终4项API](s8-01-integration-final.log)逐次验证新契约。

复现：`CONTRACT_PYTHON=/tmp/yoyo-s0-validation/bin/python pnpm check:s8`；仅显式命名S8临时库可重置。[真实旧库备份升级副本与重复033迁移](migration-verification.json)通过；原yoyo8迁移、yoyo_test26迁移及身份/文件哈希/旧表数量保留，001–032与369b1c9逐字不变。[1440](screenshots/analytics-1440.png)/[1280](screenshots/analytics-1280.png)/[390](screenshots/analytics-390.png)实际截图已视觉核对，手机表格在内部横向滚动，页面无溢出。S7与S11历史证据不覆盖。本条记录S8-01阶段验收；本轮六项整体验收见文末，真实后台OCR/真实业务用户/部署/完整发布门禁另属S0-05/S7-02/06/S9。

## S8-02 已验收产物与检查

`apps/api/src/reports.ts`、`packages/domain/src/reports.ts`、`apps/web/src/reports.tsx`及034迁移实现报告冻结、程序事实、假设/行动/缺口、不可变历史、数据失效和人工策略采纳/激活。激活需当前非空证据，撤销自动退出；选题引用活跃策略并在提交时复验。报告日期是策略复查日期，不创建已取消日历。

[104集成/10浏览器及构建类型](s8-02-final-check.log)、[最终10项报告/选题API与契约](s8-02-contract-tests-final.log)、[034升级副本](migration-verification.json)通过。[真实提供方最终两例及输入/输出/用量/哈希评分](live-reports.json)：空态partial无事实数字，净增31来自两个确认观察为final，原阶段逐例技术20/21分；不代表真实运营效果或使用者验收。[v1.0.1](live-reports-v1.0.1.json)及[v1.0.2](live-reports-v1.0.2.json)输出缺口保留，最终v1.0.3精确校验程序缺口，共享系统提示删除旧制作/活动措辞。原产品配置禁用，受限隔离评估配置启用；全部业务数据明确合成、未知价格不记零。S3-07/S8-06最终固定质量见文末，保留本阶段证据。

## S8-03 已验收产物与检查

035迁移及`feedback.ts` API/领域/页面实现人工原文、内部别名、独立笔记、分类/状态和明确用途许可。公开回复与选题线索分别授权，unknown/internal_only/revoked强制空草案/引文/线索；撤回或修改版本后在途结果拒绝，数据库再次兜底。只允许公开HTTPS格式链接，不读取外部链接，不提供发送接口。审计只存状态/用途/原因，无来信正文。

[109集成/构建类型/契约和原10浏览器](s8-03-final-check.log)、[新反馈浏览器最终2项](s8-03-browser-v5.log)、[最终10项许可/报告API](s8-03-contract-tests-final.log)、[035升级](s8-03-migrations.log)通过。完整浏览器首失败为同IP第十一次登录限流，新隔离夹具重置仅该测试库login_limits；后续加载状态/label选择器失败留存，v5使用准确可访问角色并覆盖完整授权/撤回流程。

[真实模型两例及输出哈希/技术20分评审](live-feedback.json)通过；unknown仅question分类，approved生成草案/逐字引文/线索，撤回实际清空。原文是明确合成、非真实私信；[首轮被合成标记影响的结果](live-feedback-first.json)保留，不冒充可用草案。正文合成性质记录在评估元数据，模型v1.0.1不把已明确许可/空白名单误报输入缺口。使用者实际业务验收及真实后台门禁未关闭。

## S8-04 已验收产物与检查

`apps/api/src/dashboard.ts`和`apps/web/src/home.tsx`聚合实际记录最多3项优先事项，未确认行/示例不入指标。最近账号观察按口径保留、最多15组，明确历史值及实际时间；来源异常与AI状态来自配置/数据库。批次、来源、观察及反馈深链复用现有详情与账号权限。

[3项HTTP授权/真空态/历史值/待办](s8-04-integration-final.log)、[2浏览器完整批次/来源深链](s8-04-browser-v3.log)、[构建](s8-04-build.log)/[类型](s8-04-types.log)通过。[1440](screenshots/dashboard-1440.png)、[1280](screenshots/dashboard-1280.png)、[390](screenshots/dashboard-390.png)实拍窄屏/内部滚动/键盘核对；初列名和原值断言、未构建及服务占用失败日志保留。无生产/日历/活动任务。

## S8-05 已验收产物与检查

Commands成员降级/停用需移交账号、来源与选题责任，接替人必须有效且具备相应能力，通知及审计同事务。工作区`ai_budget`配置仅包含预算/非秘密价格，下一次网关调用真实应用；有限预算必须有币种与核对价格，原产品启用/密钥仍由受限实例配置控制。运行页展示真实心跳、队列、UTC当日请求/token/未知用量/估算费用、来源健康及固定导入限额；来源最小间隔/条目配额可维护。后台任务失败筛选、重试和分页、通知及审计入口沿用实际API。

[115集成/13浏览器与构建类型契约](s8-05-final-check.log)、[24项预算/角色/许可网关](s8-05-integration.log)、[14项撤回幂等/报告/预算最终回归](s8-05-replay-final.log)、[最终类型](s8-05-types-final.log)通过。BUG-021使历史成功幂等响应复查当前许可/证据及账号权限，撤回草案不会重现。[运行窄屏](screenshots/operations-390.png)为实际测试画面。

S3-07重验：[20例v1.2.4真实提供方](ai-topics-live.json)、[逐例五维技术评审](ai-topics-review.json)、[当前输入/版本/硬门槛/输出哈希验证](ai-topics-validation.json)全通过；21请求/148348 token，费用unknown。真实提供方使用明确合成数据，不是外部平台实际后台或使用者业务批准。

## S8-06 产物与整体验收

036迁移及`source-organization.ts` API/领域/页面接入现有网关、Job/Outbox和通知。冻结原始标题/摘要/实际来源类型/采集和发布日期以及版本哈希，输出主题、受众需求、逐字引文及去重建议。人工采纳只保存观点；原始来源、观察与选题数量不变。原文变化、角色/账号版本变化、取消、伪造ID、非逐字引文、私密标记、注入数字与技术术语输出均拒绝落库；所有写入在完成事务复验，幂等重放重新检查当前来源。

最终证据以[S8完整检查](s8-final-check.log)、[来源6类恶意输出及提交竞争](s8-06-source-final-v2.log)、[报告与来源9项守卫](s8-06-guards.log)、[监控浏览器复验](s8-06-monitor-browser.log)、[契约机器验证](contract-validation.json)、[036备份副本升级](migration-verification.json)为准。完整集成120项、14条不同Chromium流程、构建/类型/124定义/74路径/89操作/26契约样例通过；监控2条重复流程不另算数量。浏览器采用明确合成模型传输，实际AI调用另见下列样本；失败重试主要由HTTP集成证明，浏览器验证诊断/详情/通知/审计入口。

[当前四工作流27例质量验证](ai-quality-validation.json)记录20选题、2报告、2反馈、3来源：真实提供方，30次请求（含实际修复请求用量）、186871 token；每维至少3、总分至少20，输入/输出哈希、当前提示词/Schema及硬守卫通过。费用unknown，统计为最终接受样本所关联请求，不含此前失败/改版全部试验成本。逐例内容与评审见[选题](ai-topics-live.json)/[评审](ai-topics-review.json)、[报告原始模型与程序落库](live-reports.json)、[反馈](live-feedback.json)、[来源](live-sources.json)。评审者Codex，仅内部技术验收；合成业务输入不冒充真实平台后台、真实私信或真人使用者批准。

来源提示词最终v1.0.2；前两轮评估夹具因读取字段/活跃采集记录唯一性中断、[v1.0.1说明术语过多](live-sources-v1.0.1.json)不通过可读性，原始输出保留。[旧报告评审](live-reports-accepted-without-raw.json)保留，补跑两例保存原始模型JSON，空态行动仅无依据假设不能激活；当前报告“按天汇总”措辞不够精确，实际程序计算为期末减期初，页面计算来源可核验，使用时仍需人工核对解释。

[来源390](screenshots/source-organization-390.png)、[来源1440](screenshots/source-organization-1440.png)、[反馈撤回390](screenshots/feedback-revoked-mobile.png)、[真实监控390](screenshots/operations-monitor-390.png)、[报告策略](screenshots/report-active.png)均为实拍，并核对无页面溢出、可访问表单/键盘与原文链接。数据库升级只操作真实旧库的受限备份副本，原使用库及凭据未升级、未清空；001–032逐字不变。S8六项任务与发布门禁分别记录，未部署或验证涨粉效果。

复现完整检查：`CONTRACT_PYTHON=/tmp/yoyo-s0-validation/bin/python pnpm check:s8`；复现已保存质量审计：`pnpm exec tsx tools/s8/validate-quality.ts`；台账/依赖/链接审计：`python3 tools/s8/document-check.py`。真实模型评估需要现有受限配置与明确授权；不得为运行测试重置原库或把配置写入仓库。

[最终数据库/配置/服务/卷实态](final-state.json)与[停止S8依赖记录](service-stop.log)通过；121项不同集成包括完整120项及[额外无依据/过期策略激活6项报告回归](s8-06-strategy-final.log)。本地交付由LOG-047对应Git提交定位。
