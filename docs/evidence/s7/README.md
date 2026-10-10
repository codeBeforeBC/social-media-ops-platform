# S7 无需OCR的数据闭环证据

2026-10-10，Codex，工作目录`/Users/junlong/projects/social-mdeida-ops-platform`，分支`codex/s7-data-loop`，基线57164a2。S7-01/03/04/05当前完成判据通过；本地交付提交由LOG-040对应Git记录定位，无推送或部署。这里的业务输入全部是合成夹具；没有实际平台后台导出、OCR或真实用户业务验收。任务状态只维护在[开发进度](../../tracking/开发进度.md)。

## 逐项产物与判据

| 任务 | 实际实现 | 验证 |
|---|---|---|
| S7-01 | [CSV](../../templates/yoyo-import-v1.csv)、[XLSX](../../templates/yoyo-import-v1.xlsx)、[中文字段说明](../../templates/S7-字段说明.md)；示例永久不可入账；现有私有分片/续传/哈希及沙箱CSV/OOXML提取，字段选择映射和手工录入共用ImportBatch/ImportRow；按账号+平台笔记ID直接匹配独立Publication，未匹配先登记 | HTTP/S3/沙箱实际解析两种模板；字段映射/未知单位/时间/身份/权限/缺失/示例隔离；浏览器上传、映射及手工路径 |
| S7-03 | 只选择合法行、部分确认、事务原子落账；逻辑键包含账号/笔记、指标/定义版本、统计类型、窗口/时间、流量、实际平台口径及时间粒度；同值复用观察并增加证据，异值明确保留或取代；文件哈希只去重文件 | 同值跨文件/手工多证据、批次内/并发去重、冲突选择过期/行不合法全回滚；未确认不进正式指标；保留异值证据supports_value=false |
| S7-04 | 不可变观察/更正链/行修正记录/撤销记录/审计；证据active状态保留，共享证据不误删；按尚有有效支持证据的最高revision恢复，撤销早期批次不覆盖后续更正 | 早期/后续/共享来源撤销、历史来源API、权限撤销；关联报告及计算stale。只保存最小报告依赖/失效钩子，无S8报告生成/反馈/策略业务 |
| S7-05 | 15原始+12派生指标字典；快照/累计/区间、自然/付费/混合/未知与平台定义分别分组；BigInt精确计算、缺失不填零、零分母null+原因、净增不充当新增关注；派生记录输入观察ID、s7-v1计算版本、实际窗口与half_up舍入规则 | 设计12金标准/异常、净增、归因关注效率、互动次数率可大于100%、观看次数加权/缺权重、累计回落、近似值、口径不可混、精确舍入及numeric(24,6)边界（原值超限拒绝、派生溢出返回null和核验原因）；新增输入与发布时间更正导致旧计算/关联报告失效 |

生成源为`packages/domain/src/imports.ts`及`tools/s7/contracts.py`/`export-schema.ts`；机器契约、SQL027–032、Prisma、API、worker、前端调用及测试同步更新。业务状态/权限沿用设计03；批次与观察生命周期分离，已确认行通过新批次更正。模板生成源`tools/s7/templates.mjs`复用宿主已有artifact-tool，需`ARTIFACT_MODULES`指向已安装模块目录，不新增项目依赖。

## 检查与证据

- [最终整套检查](final-check.log)：`CONTRACT_PYTHON=/tmp/yoyo-s0-validation/bin/python pnpm check:s7`，构建/Prisma generate/前后端类型、95集成与金标准、8 Chromium全部通过。真实HTTP/PostgreSQL/S3/容器执行，合成值与生产/用户数据隔离。[机器验证](contract-validation.json)67路径81操作110Schema及26样例通过；planned报告接口没有冒充实现。
- [指标金标准](gold-standard.log)：设计12全部10个标准算例及异常覆盖于`tests/metrics.test.ts`6组测试，另`tests/imports.test.ts`12项验账/来源/安全边界和计算持久化。缺字段/期初、零分母、组合字段不拆、流量/平台口径、不可比统计类型、净增负值与累计异常保留原因。
- [迁移验证](migration-verification.json)：保留yoyo_test受限备份恢复到新建`yoyo_s7_upgrade_1791596507806_test`，升级001–032及重复执行通过；旧表数量、5个独立笔记身份及文件ID/键/哈希不变；原yoyo_test仍26迁移/5笔记/23旧Content，实际yoyo仍8迁移。001–026与57164a2逐字不变。备份/曾失败副本留在.local/独立库，不删除数据或持久卷。
- [沙箱检查](sandbox.json)：复用现有Landlock/seccomp、网络/凭据读取拒绝与资源限额；旧45k行CSV安全校验回归。校验上限与指标提取上限分开；单批最多5000数据行/100MiB，超限明确拒绝入账，XLSX样式空行不当数据。XLSX公式/宏/外链/压缩炸弹继续拒绝。
- [模板自检](template-check.log)：导出CSV/XLSX、16列/中文字典/示例标记断言与渲染；[数据页](template-data.png)、[说明页](template-fields.png)已视觉检查。浏览器[1440](screenshots/imports-1440.png)/[1280](screenshots/imports-1280.png)/[390](screenshots/imports-390.png)无窄屏横溢出，抽屉Escape/焦点复归通过。截图为合成值。
- [应用镜像构建](app-image-build.log)及镜像内模板读取自检见`image-template-check.log`；[原dev解析器重建](dev-parser-rebuild.log)。未部署业务API/worker/scheduler。最终[服务与数据审计](final-state.json)及[文档检查](document-check.log)另列。

中间失败证据保留：`check.log`行数限额/空行计数、`browser.log`映射控件定位、`browser-final.log`固定工作区版本、`migration-check.log`迁移计数断言、`pre-permission-fixture-fix.log`权限测试夹具；各原因修正后最终95/8通过。`pre-final-hardening.log`为此前92/8通过，不替代最终检查。新增/缺失计算失效钩子与历史文件同ID重校验也已进入最终回归。

## 运行交接与未验范围

S7自己的`yoyo_s7_dev/test`库32迁移；仅yoyo_s7_test被显式授权可重置。测试工具拒绝保留yoyo_test，原实际库不自动升级。S7独立对象/解析服务59070/59080收尾stop且卷/state/对象保留；S11测试服务仍停止。原dev数据库54329、私有存储59000、按当前源码重建的解析器59010持续运行，无原业务API/worker/scheduler。旧库升级须另行停写/备份并批准；不可直接把新库交给旧程序降级。

S0-05/IN-02仍缺三类真实后台样本；S7-02/S7-06未完成，T15–18完整发布验收未关闭。未验真实平台导出/OCR、真实用户数据/业务增长、完整S8/发布门禁、托管CI及Windows/x86/原生Excel实机；不以合成测试或模板截图替代真实证据。下一步取得IN-02合法真实样本解除S0-05，再实施S7-02原图核对与S7-06真实导入验收。
