# ADR-007 删除IP资产库与内容工作间

> 最新范围覆盖：[CHANGE-008 / ADR-008](ADR-008-删除排期日历与活动.md)继续取消全部排期日历/活动、AI排期、开奖/公告/提醒、活动标记及自动回收节点；当前三导航。本文对应旧条款和工期/数量仅为历史，来源定时采集、通用Job/Outbox/通知及运行基础保留；当前范围和状态见设计基线与开发进度。

日期：2026-10-09（Asia/Shanghai）；范围依据CHANGE-007。用户要求更新设计、整理进度/计划并评估代码删除安全性。本轮完成文档与静态/只读盘点；业务代码、数据库与对象文件未删除。

## 决策与边界

推荐在现有工程定向删减，复用登录/账号隔离、事务与幂等、Job/Outbox、采集、AI网关、通知审计和部署。无需从零重建；其中两个页面和生产工作流虽可清退，但保留模块的调用需要同步修改。

取消R05/R06/R07/R10/R11/R17全部能力，包括品牌规范PDF/规则管理、素材版本/使用条件/引用/收藏、图文/视频制作单和成品编辑、审核、发布包、生产修订/归档。原“其他格式下版”不再有效。

保留R01–R04/R08–R09/R12–R15，主导航为工作台/选题/日历/数据复盘。独立Publication只用于笔记身份、实际发布时点与分析标记；导入/来源/活动证据仍需私有文件，不重建素材或内容工作间。制作与实际平台发布在外部完成。

## 核对基线与已有投入

- 工作目录`/Users/junlong/projects/social-mdeida-ops-platform`，main/HEAD a290414（S4中间检查点）；开工工作区干净，未发现上轮中断残留文件修改。
- 旧S2六项已验收；S3包含已完成的制作单、素材引用与采纳链；S4-01至05有部分实现但未最终验收，S4-06未演练；S5未开发。既有证据保留，不把取消当DONE。
- 静态读取前端入口/选题、API继承链、AI任务/Schema、文件下载、worker/scheduler、迁移001–024及契约/测试/运行配置。
- 只读`docker ps`：yoyo-dev数据库54329、存储59000、媒体执行器59010在运行；本轮未启停服务。
- 只读事务核验当前yoyo-dev的yoyo库：仅应用001–008；assets/asset_versions/rule_sets/contents/content_revisions/file_objects/upload_sessions均0行，jobs也0行。该库没有topics/publications/ai_requests表；不能把S3/S4隔离测试验收视作此使用库已升级。本结论不覆盖停止的Compose卷、yoyo_test、其他实例、存储孤儿对象或外部发布历史。

## 代码影响与安全性

| 部位 | 实际证据/调用 | 处理与风险 |
|---|---|---|
| 前端入口 | [main.tsx](../../apps/web/src/main.tsx:6)导入AssetLibrary/BriefWorkbench，六导航及hash路由 | 四导航/旧深链退出后，删除assets.tsx、asset-picker.tsx、briefs.tsx、graphic-editor.tsx、production-actions.tsx；检查style.css仅专用规则，公共组件保留。单删文件会编译失败，单藏菜单旧接口仍可操作 |
| 选题采纳与详情 | [topics.ts](../../apps/api/src/topics.ts:17)事务创建Content/修订/ai_requests/Job；详情查assets；[前端选题](../../apps/web/src/topics.tsx:16)仍展示素材及“采纳为草稿” | 改为独立决策/负责人，清除内容和素材查询/返回。旧accepted_content_id、topic_decisions.content_id外键及幂等响应需迁移/版本隔离；重复接受仍不能重复决策 |
| 选题AI | [ai.ts](../../apps/api/src/ai.ts:14)读取规范/素材；[ai-tasks.ts](../../packages/domain/src/ai-tasks.ts:17)和[topics.ts](../../packages/domain/src/topics.ts:8)依赖快照/过期守卫；ai-workflows.ts含制作Schema | 移除rule/assets输入、素材白名单/缺项和graphic/video分支，保留topicSpec、网关安全/成本/来源版本守卫；更新缓存/提示词/Schema版本，不复用旧结果。只删除资产表会让保留的选题任务SQL失败 |
| 生产API/领域 | main.ts挂载Publications；[publications.ts](../../apps/api/src/publications.ts:7) extends Production，Production extends Contents | assets.ts、contents.ts、production.ts及domain briefs/publication-payload/export-package专属代码可在调用清退后删除。publications.ts不能直接保留继承链，需改为独立登记类；Files中的导出guard一并收口 |
| 发布笔记 | [迁移022](../../packages/db/migrations/022-publications.sql:10)强制content_id/revision_id，身份触发器含旧字段；023/024修订关系 | 复用Publication ID和账号/平台ID/时间/标记，补独立title/media_type，移除生产外键和守卫依赖。不得为省代码删掉实际笔记和下游历史指标；无需保留正文、审核或外部改稿流程 |
| 文件/媒体 | [files.ts](../../apps/api/src/files.ts:20)只接受asset/guideline，权限asset.edit；link依赖exportGuard；[worker](../../apps/worker/src/main.ts:12)注册media.preview/content.export；scheduler调用Files.expire | Files/Storage共享能力必须按导入/证据purpose与账号权限改造，不能整删。去掉ZIP/手册分页/素材缩略图任务，但保留导入安全解析和会话恢复；旧签名URL在TTL内仍可能有效，需盘点/revoke或等待失效，不能声称路由删除即撤销 |
| SQL/Prisma | [迁移005](../../packages/db/migrations/005-assets.sql:72)建立rule与content基础及s2_immutable；010/013继续用该函数；013/015/022/024均有生产外键 | 不删除/改写已应用001–024；新增迁移解除关系，保留共享不可变函数。Prisma目前仍主要反映S2结构，需依据SQL更新而非直接删模型/db push。DROP CASCADE会掩盖保留对象损坏 |
| 任务/权限 | worker/scheduler、protocol.ts、contracts types、成员UI及DB角色约束、jobs/outbox/ai_requests | 禁止创建旧任务，清理queued/未分发事件，running取消后提交时再拦；ai.generate不能整组取消，只退出graphic/video请求。reviewer按03迁移为授权读取，组合权限不升级。旧通知去掉操作链接/标失效，留历史用量和审计 |

## 调用、测试、夹具、配置和出口清单

- 修改调用：apps/api/src/main.ts/topics.ts/ai.ts/files.ts/publications.ts；apps/web/src/main.tsx/topics.tsx；packages/domain/src/ai-tasks.ts/ai-workflows.ts/topics.ts/protocol.ts/jobs.ts；apps/worker和apps/scheduler入口。保留Commands/Auth/Collection/SourceEvidence/AIGateway/Jobs/Storage公共接口。
- 退出专属测试：tests/assets.test.ts、briefs.test.ts、production.test.ts、production-browser.spec.ts、pdf.test.ts及S2专属兼容/安全用例。files/s2-helpers中保留或迁出仍有价值的签名/续传/哈希/解析权限断言，不用删测试消除真实故障。
- 更新保留测试：api/topics/ai-tasks/ai-evaluation/permissions/jobs/browser；全局API空态及四导航、角色、幂等新响应、零资产推荐、独立笔记、旧任务竞争、新旧迁移必须覆盖。tests/helpers.ts和tools/browser-server.ts清除生产表种子依赖。
- 夹具/评估：tests/fixtures/ai-evaluation-cases.json、tools/s3/evaluation-fixtures.ts/evaluation-checks.ts改为保留场景；guideline.pdf退出适用集，transparent.png可用于导入图片安全测试，不因“图片”整删。20例旧证据不重写。
- 契约与出口：contracts/openapi.json/domain.schema.json及packages/contracts/src/types.ts；tools/s0/generate-contracts.py、s1/contract-extension.py、s2/contracts.py、s3/contracts.py/ai-contracts.py/topic-contracts.py/brief-contracts.py、s4/contracts.py。修改生成链及样例后再生成，不能只改JSON；旧生成器解析本次05/06时可能不兼容，必须在S0-08收口。
- 工具：移除/归档s3-brief-live-probe、brief-browser-seed、topic-adoption旧响应及s4工具；s3-ai-evaluation、compose-business-smoke和其他真实AI探测按新工作流修改。S0来源探测保留；S0/S2媒体兼容脚本不再是当前交付门禁。
- 配置：tools/test-env.mjs（当前默认未包含production.test.ts，旧S4不能靠默认test宣称完整覆盖）、tools/dev.mjs、tools/s2/check.mjs、package.json、compose.yaml/compose.dev.yaml、Dockerfile、tools/media及.github/workflows/ci.yml、环境模板和README。停止独占素材处理服务/依赖前检查OCR/表格解析是否仍需要；不删除DB/存储持久卷。pnpm-lock.yaml随实际依赖变化更新，不增加框架或替代库。

## 推荐清退顺序及验收

1. S0-08、S1-07、S3-05、S3-07按新契约/四导航/采纳/评估重新验收；先定义Publication和文件purpose兼容接口，建立一个发布/数据身份模型，不建第二套工作间。
2. S11-01独立笔记及兼容迁移：旧Publication ID保留，title/media_type映射，空库/有旧记录副本均验证；S11-02收口导入文件权限和格式。业务代码与新契约同批切换。
3. S11-04处理旧队列/Outbox/幂等/缓存/通知/角色及旧关系；备份清单脱敏、无凭据。保留数据引用完整，停止旧worker提交后再移除功能。物理表清理可分后续兼容迁移，产品退出不等于立即销毁历史。
4. S11-03删除专用前后端/领域代码、任务处理器、导出/品牌解析依赖及测试/生成工具/config。构建/类型/契约和保留集成测试通过，再进行浏览器验收。
5. S11-05执行T25/T26及受影响T01/T05/T19/T21/T23，验证旧端点不可调用、无旧Job、零素材可推荐、独立笔记可登记/关联活动，空库安装及旧库升级可复现。文件本体清理只在完整引用扫描和恢复证据后进行。

已有历史数据的删除或角色/身份迁移不能靠当前空使用库推定安全。切换过程中旧应用可能要求原schema，故先采用兼容新增和停写；真正拆表后，回滚依赖备份及已演练流程，不承诺无损降级。

## 删除与重建比较

| 方案 | 代价/结论 |
|---|---|
| 只删两个页面/目录 | 最少表面改动，但残留API/旧任务，选题与独立笔记会失效；不能满足全部删除 |
| 定向删减并小改耦合点 | 推荐；保留基础及真实来源/网关投入，重写独立登记和采纳事务的短段代码、配套迁移/验证 |
| 全部推倒重来 | 仍需重做权限、可靠任务、真实来源/AI接入、数据迁移和部署；不能消除历史数据清理，当前无架构证据支持这样更简便 |

当前开发使用库为空，可用空库验证新安装，但不能因此重写已有迁移历史；其他交付/测试实例仍可能需要升级。若以后明确证明所有实例均可丢弃，数据库新基线可单独评估，仍不需要重写保留应用。

定向清退含兼容/契约/测试预计4–7有效人日；实际量由旧库/对象引用与运行任务盘点校正。剩余业务计划见详细实施计划，不把旧已投入工时从从零估算直接相减。

## 本轮验证限制

执行静态调用/SQL/测试/配置盘点和上述脱敏只读数据库统计，未运行构建、产品测试、契约重新生成、迁移写入、浏览器/采集/模型调用或实际清理。本轮文档检查结果记录于任务台账；安全结论是可执行的有条件方案，不是删除演练通过证据。
