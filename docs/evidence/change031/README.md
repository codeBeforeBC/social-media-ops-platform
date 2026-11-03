# CHANGE-031 候选选题列表与说明层级优化

2026-10-30；Codex；`/Users/junlong/projects/social-mdeida-ops-platform`，`codex/s9-acceptance`/`34317f8`加既有与本轮未提交修改；保留CHANGE-027/028/029/030和BUG-042。任务事实见[开发进度](../../tracking/开发进度.md)，范围见[原规划](../../plans/CHANGE-031-候选选题列表与说明层级优化规划.md)，逐项证据见[完成核对](acceptance.md)。

候选区改为单列紧凑条目，默认待采纳。列表聚焦标题、两行角度、真实去重参考来源和少量核验提示；完整长待补、关注理由、评分及未知工时退出列表。共用说明读取保存的真实批次，并随分页合并；详情保留具体风险和原文/推断/原创分组，生成说明、AI六维评分和决策记录默认折叠。筛选支持会话恢复/明确深链与修改后刷新保持；失败保留内容、分页可重试、迟到响应不覆盖新筛选。原有采纳/拒绝/变体和过期守卫保持。

新增只读展示摘要，不改变生成输入、原始候选或业务状态，不调用AI做摘要，无迁移/依赖新增。精确的已知系统缺口才移动为批次说明；未知/版权等实际风险保留，不用一般关键词删掉风险。空输入对象不冒充资料齐备，变体的单条工时不改变整批说明；历史缺记录使用真实未知状态。

主要产物：[展示整理](../../../packages/domain/src/topic-presentation.ts)、[API集中读取](../../../apps/api/src/topics.ts)、[前端](../../../apps/web/src/topics.tsx)、[局部样式](../../../apps/web/src/style.css)、[契约生成源](../../../tools/s3/topic-contracts.py)、[边界测试](../../../tests/topic-presentation.test.ts)、[HTTP/范围测试](../../../tests/topics.test.ts)、[页面回归](../../../tests/browser.spec.ts)。

| 检查 | 范围与证据 |
|---|---|
| 最终完整后端 | [196通过](api-tests.log)，包含7新增展示边界、2新增HTTP/集中读取集成；原采纳唯一性/冲突/权限/过期、账号/删除/导入/指标/AI/来源等保留业务通过 |
| 最终后端复验 | [18项通过](api-final.log)，最后的不可读历史来源格式兜底，及原来源/版本/决策/权限/批次边界 |
| 页面专项 | [9通过](browser-targeted.log)，包括必要夹具前置、列表/详情、批次分页合并、追加失败恢复、筛选恢复/迟到响应及原操作 |
| 最终完整页面 | [49项完整回归](browser-tests.log)，覆盖既有账号、删除、运行状态/审计与其他业务页面；最后历史解析守卫后再执行[最终49项完整复验](browser-final.log) |
| 静态契约 | [75路径/90操作/137定义/35样例](contract-validation.json)；新增只读摘要与正常/负数/未知枚举/缺字段/无效日期样例，逐HTTP响应校验保留 |
| 构建 | [原生](build.log)、[类型](typecheck.log)、[源码Docker](docker-build.log) |
| 合成视觉 | [1440](screenshots/compact-list-1440.png)、[1280](screenshots/compact-list-1280.png)、[768](screenshots/compact-list-768.png)、[390](screenshots/compact-list-390.png)、[320](screenshots/compact-list-320.png)默认折叠列表；[混批展开](screenshots/compact-generations-1440.png)、[详情](screenshots/compact-detail-390.png)。明确合成夹具，不是实际生成/事实核验通过证据 |
| 实际只读 | [结果](local-browser.json)：默认待采纳空态正确，原两题仍expired且分别1来源；列表/详情同五宽度无横溢出，键盘展开/焦点返回及详情底部操作可见，0页面错误/0写请求。原始业务文字/账号用临时浏览器样式隐藏；[实际列表390](screenshots/local-list-390.png)、[实际详情390](screenshots/local-detail-390.png) |
| 本地更新 | [部署](local-deploy.log)、[资源与数据核对](local-runtime.json)：JS/CSS与commands/topics/topic-presentation编译匹配；62业务表完整count/hash、默认身份与私有AI配置保持，41迁移不变 |

首次新增测试的数组被推断never[]导致类型检查失败，原[typecheck-stage1](typecheck-stage1.log)保留。首轮页面专项2过4：[原日志](browser-targeted-first.log)分别是未带前置账号/来源的夹具、旧空态文案和原生select的精确label定位；按可访问combobox定位并带上前置后9通过。原记录不改成成功。完整后端在上下文审计前[194通过](api-tests-before-context-audit.log)，补充空对象与批次稳定性检查后195通过；补齐不可读历史来源回退后196完整及18最终后端专项通过。公开日志仅规范行末/结尾空白，原始副本受限保留。

仅no-deps更新本地API，网页3000/存储59001；worker/media/scheduler、宿主桥接59025及dev依赖保持，S8测试服务最终停止且卷保留。回滚镜像`yoyo-local:change031-api-rollback`已核对，沿用已有受限备份，无新数据备份；旧CHANGE-027/029/BUG-042历史截图从私有副本恢复。未代生成/采纳/拒绝/删除实际选题，未发起真实模型或采集。未提交/推送，原发布门禁保持。
