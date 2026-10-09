# S3 验收证据

2026-10-08，工作目录为当前项目main，开发基线aa2fe15；本阶段尚未提交。S3-01及S3-03已验收，S3-02仍待来源范围/稳定性收口，不代表S3完整验收。

## S3-01 采集运行框架

产物：迁移009、Collection服务/API、worker/scheduler接入、选题页面来源连接与运行记录、[源码清单](collection-runtime-source-manifest.json)、[浏览器截图](screenshots/collection-runtime.png)。默认每日09:00/16:00，Asia/Shanghai；每源最小刷新间隔30分钟；同连接事务锁和活动运行唯一索引复用任务；配置版本守卫、取消同步、登录/限流立即暂停及连续三次失败暂停；验证成功解除暂停。负责人为本实例实际操作成员。

验证结果：

- `pnpm build`、`pnpm typecheck`通过。
- `node tools/test-env.mjs pnpm exec tsx --test --test-concurrency=1 tests/collection.test.ts tests/jobs.test.ts`：6项采集框架和7项任务回归全部通过，包括真实子进程SIGKILL租约恢复。后续契约更新后6项采集测试复跑通过，见[日志](collection-runtime-tests.log)。
- `node tools/test-env.mjs pnpm exec playwright test --grep '首次设置|来源连接'`：2项真实Chromium流程通过，见[日志](collection-browser-tests.log)。第一轮新增测试错误地预期“排队中”，实际公共组件为“等待处理”；修正断言后复跑通过，未把首次失败记成功。
- OpenAPI126操作及21个历史Schema例通过，见[契约检查](contract-validation.json)；已实现采集接口的成功/错误响应另由API测试核对。

采集测试的适配器输入为明确受控数据，证明运行框架及失败语义，不作为三类来源真实接入证据。真实来源、证据持久化、AI网关/制作单/评估在S3-02至07续接。未执行本轮完整产品回归、Compose镜像更新及真实采集定时验收；阶段完成前继续补齐。

原生开发数据库/存储/媒体执行器保留；测试数据库独立，测试服务已退出。OpenCLI doctor确认本机现有Bridge/profile可连接，后续真实采集会使用；没有启用产品自动来源任务。

## S3-02真实来源适配（实现/验证中）

- 产品适配器：微博hot_band、固定OpenCLI1.8.8的小红书搜索与有界详情读取；默认最多50条、参考笔记每词最多一篇详情，保留原日期文本/缺失发布时间，不保存签名导航URL。
- `pnpm sources:setup`按版本锁安装宿主机依赖并验证补丁哈希，生成本地0600 bridge凭据；`pnpm sources:bridge`提供仅本机的认证RPC，Compose可配置host.docker.internal连接宿主机浏览器。凭据不进入仓库或镜像。
- [适配器直接实测](source-adapter-live-probe.json)：小红书两类真实读取各3条，参考笔记1篇详情；[完整任务链实测](source-worker-live-probe.json)：小红书经实际定时槽→Outbox→Job→适配器→不可变观察成功，微博该轮发现上游51条而失败。
- 首轮小红书失败是产品字段名id/external_id不一致，保留[首轮失败](source-worker-live-probe-first-failure.json)，修正后完整任务链通过。微博51条为真实返回变化，不再要求上游恰好50条；仅截取配置限额，记录上游条数；[微博修正后实测](weibo-worker-live-probe-fixed.json)成功，保留[定位记录](weibo-worker-live-probe.json)并新增51条受控回归。
- [Bridge认证和Docker宿主访问](source-bridge-check.json)：无凭据401、有凭据200、非法输入422，Docker容器通过host.docker.internal成功；[实际worker经RPC读取](source-bridge-worker-live-probe.json)成功。
- 这些实际定时槽是测试当时分钟的验收槽，不冒充09:00/16:00跨日观察。S0跨日/真实登录恢复及参考账号/IP入口覆盖仍需收口，S3-02不能标DONE。

## S3-03来源证据与页面

迁移010、SourceEvidence及来源页面提供ID去重、不可变观察、旧观察不覆盖当前、标题主题保留独立来源、时效/关键词/来源/游标分页和原始链接/缺失时间说明。公开互动原值及近似标记保留，不转成阅读或涨粉。受控夹具与实际来源实测分别保存。

本轮新增源证据与框架回归、浏览器详情/筛选、构建类型及契约检查记录见最新日志；第一轮SQL别名similar触发保留关键字错误，修复为peer后测试通过；浏览器夹具第一轮动态导入不受Playwright转换支持，改为独立tsx播种脚本后3个浏览器流程通过。未把历史失败改成成功。

S3-03最终检查：12项来源框架/证据/51条/独立主题回归全部通过，见[集成日志](source-evidence-tests.log)；3个浏览器流程通过，见[浏览器日志](source-evidence-browser-tests.log)。[构建](source-evidence-build.log)、[类型](source-evidence-types.log)、126操作/21例契约检查通过。本轮源码见[清单](source-evidence-source-manifest.json)。其中浏览器证据线索明确为合成夹具，实际平台证据单独保存在上方真实来源报告。

## S3-04 AI网关核心实现与业务小样本

迁移011、AIGateway及业务Schema已经实现：0600本地服务端配置、固定DeepSeek地址、结构与ID白名单、一轮修复、输入/Schema/引用/提示词/模型/验证器版本缓存、同输入单并发、放弃运行恢复、超时/取消、用量与未知费用/配置单价估算、有限额度事务预留。Job取消或租约失效会中止处理器信号，旧输入版本拒绝候选副作用。凭据不进入报告/镜像/Git。

- [25项回归](ai-gateway-tests.log)：12网关、6采集和7持久任务通过；包括真正并发预算预留、一次修复累计额度、跨空间/非运行任务、损坏缓存、Job取消及过期结果。受控模型只是故障/事务测试。
- [构建](ai-gateway-build.log)及[类型](ai-gateway-types.log)通过，[源码清单](ai-gateway-source-manifest.json)对应未提交main工作树。API契约本轮无新增已实现操作，不宣称AI HTTP入口已经接通。
- [真实业务小样本](ai-business-live-probe.json)：真实DeepSeek/deepseek-flash生成选题/图文/视频，各最终合法并缓存复用，共16900 tokens；输入为明确合成业务用例，非真实运营事实，不代替来源或后台验证。费用未知，内容质量尚未人工评审。
- 该首轮选题发生一次修复；网关校验曾误把嵌套证据对象当ID，修正并新增回归后，仅复跑受影响选题。[修正后实测](ai-topics-live-probe-fixed.json)一次成功，3候选，缓存命中；历史首轮报告保留。
- 未完成：网关与候选生成/制作单持久任务及配置界面的产品连接、20例固定评估与质量/真实材料核验。S3-04仍DOING，S0-06仍VERIFY，S3尚未完成/提交。未运行本轮浏览器或Compose镜像演练，本轮未改页面。

## AI产品任务接入续接

迁移012和AIRequests/AITasks接通`POST /topic-generations`、`GET /ai-requests/{id}`及真实worker。服务端冻结账号、规范、来源观察/哈希、可用素材版本/范围、栏目和产能，不接收客户端任意提示词或伪造白名单。结果只保存建议；账号/工作区/规范/成员/资产变化在Job提交事务再次校验。失败/取消保留可查原因，人工工作流可继续。

- [24项回归](ai-runtime-tests.log)：5个产品AI任务/API契约、12个网关、7个任务。包括API幂等、配置禁用、无效时间、取消、模型失败、账号版本变化和处理器返回后提交前的版本竞争。
- [真实worker调用](ai-worker-live-probe.json)：明确合成账号和无来源材料，经API→Outbox→worker→真实DeepSeek生成4个原创候选，1次调用5391 tokens；结果通过API读取，未创建内容。不是实际运营来源或质量评审。
- [构建](ai-runtime-build.log)、[类型](ai-runtime-types.log)及[127操作/21例契约](contract-validation.json)通过；[源码清单](ai-runtime-source-manifest.json)。第一轮测试辅助函数命名遮蔽process，修正后发现观察字段应为source_item_id；修正后复跑通过，[历史失败](ai-runtime-initial-failure.log)保留。
- 安全本地配置入口`pnpm ai:config status`仅输出是否配置、启用状态、模型和预算模式；`pnpm ai:config set < /受限目录/config.json`从stdin接收配置，0600原子写入；`enable`/`disable`不打印凭据。当前用户原始配置仍disabled，真实探测使用临时0600启用副本并清理，没有在产品实例启用AI任务。
- 原生默认`.local/ai/deepseek.json`，可用AI_CONFIG_FILE指定。Compose明确使用持久卷`/state/ai.json`，可通过`docker compose exec -T worker node dist/tools/ai-config.js set < /受限目录/config.json`写入。凭据不写入镜像或仓库。本轮未实测Compose AI配置命令，整阶段容器演练继续补齐。
- 下一步候选落库/评分/拒绝/采纳事务及页面（S3-05），再生成候选制作单版本（S3-06）；S0-06/S3-07真实材料和20例质量评估仍待收口。任务状态只以开发进度台账为准。

## S3-05候选业务与采纳

迁移013/014建立候选、不可变证据及决策记录，AI完成事务按输入白名单写入，六项权重服务端算分。来源证据绑定同空间同一源条目的具体观察；显示历史标题/原始链接，不随最新条目变化。生成批次和缺项保留，缺规范/素材/工时由服务端追加，模型不能删掉缺口。

采纳锁定选题并原子创建draft/首版本/真实Job及Outbox记录，不同请求键重复采纳返回同一结果；形式/负责人不同提示创建变体。拒绝需理由，过期阻止直接采纳；明确变体独立保存父题和证据。负责人默认本人，编辑不得分配他人；账号/空间守卫继续有效。页面提供账号/状态/形式筛选、理由/评分/证据/资源/缺项、拒绝、采纳和变体父题入口。

- [43项回归](topic-tests.log)：8选题、5AI任务、13网关、10API基础、7Job通过；此前来源证据联合18项通过。包含并发采纳/拒绝竞争、事务回滚、越权、原观察绑定、原始标题不改写、时效与Date序列化。
- [4浏览器流程](topic-browser-tests.log)通过；[窄屏截图](screenshots/topic-candidates-mobile.png)检查无页面溢出，夹具明确合成。[构建](topic-build.log)、[类型](topic-types.log)、[127操作/21例契约](contract-validation.json)通过，[源码](topic-source-manifest.json)。
- 首轮迁移缺观察的空间组合唯一键，修正未应用迁移后通过；浏览器精准label定位改为可访问combobox定位后通过。保留[迁移失败](topic-initial-migration-failure.log)、[浏览器失败](topic-initial-browser-failure.log)。
- BUG-003：发现通用canonical将数据库Date变成空对象；修正为ISO并回归提示词与缓存等价，源观察过期计算同时保留毫秒。没有把旧日期丢失当真实时间缺失。
- [首轮真实候选落库](topic-worker-live-probe.json)4条/4404 tokens，但模型把来源窗口结束填为常青到期，随后[采纳实测](topic-adoption-live-probe.json)正确拒绝并未创建内容（BUG-004）。提示词v1.0.2与业务校验拒绝无来源原创到期后，[修正实测](topic-worker-live-probe-fixed.json)3条常青候选，均null到期；[真实模型输出并发采纳](topic-adoption-live-probe-fixed.json)两次201指向同一draft/首版本/queued制作单Job。所有输入仍为明确合成业务材料，实际模型调用和真实来源材料不能混淆。
- 技术流程通过；S3-04/S0-06质量依赖及来源真实范围尚未关闭，任务状态见进度。制作单Job只已排队，不宣称候选制作单版本/应用或实际成片已完成；下一步S3-06。未执行本轮Compose整阶段演练或内容发布。


## S3-06制作单候选与应用

迁移015/016、Contents API、AITasks和内容工作间接通图文逐页/连续视频分镜生成。输出冻结为ai_candidate修订，不改变当前草稿；采用时校验内容版本、基础修订及完整载荷、候选哈希、人工锁定字段与素材版本，原子建立新草稿和反向引用。旧草稿和候选均保留，冻结修订全部字段禁止改写。默认保留已确认目标、人群与关注理由，可另锁定标题、正文或已有字段路径；锁定合并后再次核验结构。只读/账号范围沿用服务端权限。S4完整编辑与审核尚未实现。

- [38项回归](brief-tests.log)：5制作单、8选题、5AI任务、13网关及7Job通过；真实存储上传合成PNG/媒体解析后确认版本，采用落库引用，停用后拒绝采用；涵盖迟到结果、版本竞争、跨内容候选、危险路径、人工锁定及冻结不可改写。模型响应受控，不能当真实服务证据。
- [5浏览器流程](brief-browser-tests.log)通过：基础导航、来源、候选采纳及制作单预览/确认采用/锁标题重新生成。已检查[窄屏截图](screenshots/brief-candidate-mobile.png)，无页面横向溢出，夹具明确合成。
- [真实DeepSeek全任务链](brief-worker-live-probe.json)：真实用户提供参考PNG上传/解析/确认，经两个明确合成选题采纳Job生成6页图文及4段连续视频分镜，均冻结候选、采用前原稿不变、采用200；两个候选采用后共6条真实素材版本引用。总12062 tokens、各一次调用，费用unknown。实际文件存在不等于已制作图文成品或成片；未做人工运营质量评审。该探测加载提示词v1.0.2；最终v1.0.3增加画幅验证版本标识与锁定合并结构复查，由38项回归验证，未重复无必要外部调用。
- [构建](brief-build.log)、[类型](brief-types.log)、[127操作/21例契约](contract-validation.json)通过，[源码清单](brief-source-manifest.json)。首轮资产夹具漏owner_id，探测先后漏ip_identity/媒体预览前置，均由API正确拒绝；修正夹具后通过，历史失败日志/报告保留，未放松S2守卫。
- S3-06技术通过，S3-05/S3-04质量硬依赖未关，保持VERIFY。下一步S3-07固定20例评估及S0质量/来源收口；S3尚未整阶段完成或提交，未进入S4。临时AI配置0600且已清理，原始配置disabled，无产品实例自动调用。未执行本轮Compose AI演练、真实发布或成片验收。


## S3-07固定评估与引用/费用守卫续接

固定20个定义和可复现冻结输入位于tests/fixtures/ai-evaluation-cases.json及tools/s3/evaluation-fixtures.ts，覆盖图文/视频、缺数据、矛盾来源、同名IP、混合流量、極少样本、过期、伪造引用/音轨、文档注入、人工锁定。`pnpm ai:evaluate`仅使用独立*_test数据库，真实模型调用授权配置；逐例及时写入输入哈希、版本、结果、用量/费用及错误，需串行运行，不与其他重置测试库的命令并发。

- [首轮20例](ai-evaluation-first-run.json)全部返回合法结构，但评审发现已给样本数误报缺失、部分制作单泛泛占位；评估检查器还把拒绝说明中的攻击标记误判为越权。报告和日志原样保留，不当通过证据。
- [第二轮20例](ai-evaluation-v2-live.json)采用v2输入及提示词v1.0.4，18例返回结构、2例服务响应不完整而明确失败；输出中引用允许source_id却拿任务标题作来源事实（E02）仍是证据错配。存在攻击标记误判未最终评分，不能用整体结构成功率关闭质量门禁。
- 提示词v1.0.5及生产守卫：fact只接受对应冻结source.title/summary的非空逐字片段，推断另标；网关与saveTopics事务均校验，白名单ID不能替任务字段背书。页面标为“来源原文（真实性待核验）”，保留历史，不把原文存在当其内容已经核实。
- 截断响应使用AI_OUTPUT_TRUNCATED明确失败；服务端响应已给token用量时，即使载荷不可用，也记录真实token及配置费率估算，不能把失败收费调用当零。未给用量仍unknown。
- [43回归](ai-evaluation-tests.log)及[5浏览器](ai-evaluation-browser-tests.log)、[构建](ai-evaluation-build.log)、[类型](ai-evaluation-types.log)、[契约](contract-validation.json)通过，[源码清单](ai-evaluation-source-manifest.json)。包含警告拒绝文本与公开文案区分、事实换源/伪造/任务字段拒绝、零候选事务回滚、锁定、截断用量和费用记账。控制响应不冒充真实服务。
- [新版真实评估](ai-evaluation-v3-live.json)使用同一20定义、v2冻结输入及v1.0.5；本次交接时仍运行（exec session93003，日志/tmp/yoyo-s3-eval-v3-live.log）。为避免上轮截断，单次评估输出上限16000、90秒；这是有界评估配置，不改产品默认。最终逐例硬门槛及五维质量评审尚未完成，S3-07保持DOING。
- [Compose配置6项检查](compose-ai-config-check.json)通过：stdin设置disabled、持久卷路径/0600、worker重启、同实例API读取、零自动AI任务；凭据清理且专用yoyo-s3-ai-smoke已停止、卷保留。验证镜像和范围明确，不冒充新提示词业务容器调用。
- 用户目标已收敛为仅S3（CHANGE-005），不再推进S4–S7。S3整体未验收或提交，來源稳定性/登录恢复/IP及参考账号与质量依赖继续收口。


## 2026-10-09 公开文案与参考账号续接

[公开文案质量修正](公开文案质量修正.md)保存三/四轮发现的标记泄漏和未证实科学规律；v1.0.7第五轮固定20例正在执行（session47283），最终语义评分待完成。三轮93003及四轮17319已经终态1，不再恢复这些历史句柄。

参考账号实现严格公开ID配置、最多两账号、账号笔记身份核对、每账号最多一篇详情；默认关键词补齐IP。覆盖报告区分请求/实际完成/预算耗尽，UI区分公开账号笔记与搜索/官方榜，不把账号技术选择称为质量背书。

- [真实参考账号及详情](reference-account-live-probe.json)：公开作者主页返回两条，新增两条账号笔记，一篇97字详情及真实赞藏评；ID用哈希脱敏，签名不存。原始配置在ignored .local，凭据不进入文件。
- [四关键词综合读取](keyword-coverage-live-probe.json)、[四关键词最新信号跨日读取](topic-keyword-cross-day-live.json)：真实旅行/IP/潮玩/情绪价值，缺日期仍null，外部媒体reference_only。
- [微博产品跨日读取](weibo-cross-day-product.json)及[旧探测失败](weibo-cross-day-legacy-probe-failure.json)：旧S0脚本把超过50条当结构变化，产品适配器按已有修正截取配置限额并成功；不删除旧失败，也不把旧脚本结论冒充产品失败。原设计允许受控失败恢复，验收解释见ADR-006第25条；没有主动退出账号或伪造实际重新登录。
- 无库严格身份/签名与既有导航守卫11项通过；新配置API/浏览器和完整worker真实恢复验证待第五轮终态后运行。agent-reach命令当前PATH不可用，使用技能指定的现有OpenCLI1.8.8后端；不是新建爬虫或换账号。构建/类型与127操作21例契约已检查，最终源清单/集成检查继续。

## 2026-10-09 最终阶段验收

本目录前述运行中/失败条目保留为历史。最终 [阶段验收](S3阶段验收.md)、[运行说明](S3运行说明.md)、[20例逐例技术评分](ai-evaluation-v5-review.json) 给出当前结论。74全量回归、5浏览器、后续20受影响回归/11来源守卫及最终构建/类型/契约通过；真实采集、恢复和Compose AI业务链分别记录，没有以合成材料替代真实来源或人工发布批准。

日志保留命令结果与错误内容，仅规范化行尾空白。PNG与解析器回归证据另存本目录，S2原始历史证据保持原交付版本。
