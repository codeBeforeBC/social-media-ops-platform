# CHANGE-028 自动账号时区与新增必须验证

2026-10-29；Codex；目录 `/Users/junlong/projects/social-mdeida-ops-platform`，分支 `codex/s9-acceptance`，基线 `34317f8`。保留CHANGE-027未提交修改；状态仅见[开发进度](../../tracking/开发进度.md)。

用户批注要求取消账号时区配置，自动识别浏览器时区；新增不能只保存。用户随后明确选择“添加时必须提交验证，失败保留记录以便重试”。

账号表单移除时区输入，自动提交浏览器IANA时区；新建只保留“添加并验证”，档案必填。后端POST在同一事务内创建账号、关联及验证Job/Outbox/审计和幂等记录，排队失败全部回滚；201包含真实验证摘要，失败保留、独立重验与冷却沿用现有流程。提交不等于验证通过，不自动声明管理权限。旧账号与其时区/状态未批量修改，已有备注编辑不提交时区。

主要产物：[API组合事务](../../../apps/api/src/main.ts)、[幂等摘要重读](../../../apps/api/src/commands.ts)、[账号页面](../../../apps/web/src/main.tsx)、[必填档案](../../../apps/web/src/account-verification.tsx)、[契约生成源](../../../tools/s1/contract-extension.py)、[API回归](../../../tests/accounts.test.ts)、[页面回归](../../../tests/browser.spec.ts)。无迁移或依赖新增；此前运行状态重设计保留。

| 验证 | 范围与证据 |
|---|---|
| 后端专项 | [35项通过](api-first.log)：创建/验证/幂等/版本/取消/旧删除及原子失败回滚 |
| 完整后端 | [187项通过](api-tests.log)，串行独立测试库，覆盖强删/文件/指标/AI预算等保留业务 |
| 全页面 | [41项通过](browser-tests.log)，含自动纽约时区、原子添加单请求、必填档案、状态/重试/错号/历史、运行状态改版和切页守卫 |
| 最终页面复验 | [7项通过](browser-final.log)，必填标识调整后重新验证新增、身份流程、错误/重试、删除和自动时区；最后标签同行排版由实际只读表单再验 |
| 契约 | [75路径/90操作/133定义/29样例](contract-validation.json)，browser_profile_ref缺失/null/路径注入样例拒绝 |
| 构建 | [原生](build.log)、[类型](typecheck.log)、[Docker](docker-build.log)通过 |
| 实际只读表单 | [结果](local-browser.json)，无手动账号时区、无仅保存、唯一添加并验证、必填档案；1440/390/320无横溢出，预览/取消0写请求、0页面错误；[桌面](screenshots/local-form-1440.png)、[手机](screenshots/local-form-390.png)、[窄屏](screenshots/local-form-320.png)，真实档案遮罩 |
| 本地保持 | [更新](local-deploy.log)、[核对](local-runtime.json)：62业务表count/hash、默认身份和AI配置保持；41迁移不变，JS/CSS及后端编译匹配已测产物 |

测试夹具同步：导入/指标/报告等测试显式使用[仅限独立测试库的旧账号种子](../../../tests/helpers.ts)，代表既有未验证历史数据，避免新增流程的验证Job干扰其他领域的任务领取；不是生产API绕过开关。真正的API新增、验证、浏览器和防回退用例走新接口，检查必须排队。使用该测试Client的OCR/模型/性能夹具同步，合成Compose smoke传入合成档案且关闭真实桥接。固定旧版本交付脚本仍按其历史构建使用，本轮未运行或改写旧发布场景。

首轮页面专项8过1旧定位器歧义（核验区也展示同一ID）；[日志](browser-targeted-first.log)保留，改为定位详情顶层只读ID。首次全量38过3，两个旧浏览器夹具缺少新必填档案，一个备注成功文案断言未同步；[日志](browser-tests-first.log)保留，修正后完整41及最终7项通过，不把首次失败改写为通过。原始日志私有保留，公开日志仅规范行末空白。生成器默认写出的旧S8契约清单恢复历史原件，新清单放本目录。

仅no-deps更新本地API；网页3000/存储59001，worker/media/scheduler、宿主桥接59025及dev依赖保持。S8测试服务最终停止，卷保留；回滚镜像`yoyo-local:change028-api-rollback`已核对，沿用已有受限备份，无新数据备份。没有对截图中的真实账号执行添加或验证、没有新真实模型/采集/平台写入。未运行真实提供方评估/旧版本发布演练。尚未提交/推送。
