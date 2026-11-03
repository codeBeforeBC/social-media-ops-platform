# CHANGE-035 删除可用工时参数

2026-10-31；Codex；`/Users/junlong/projects/social-mdeida-ops-platform`，`codex/s9-acceptance`/`34317f8`加全部既有及本轮未提交修改。任务状态只维护于[开发进度](../../tracking/开发进度.md)。

生成候选移除“本次可用工时”，工作区设置移除“每周可用工时”，页签/标题改为“AI 预算”。金额预算、价格、token计量保持。生成接口与契约不再接收capacity_hours，设置写入不再接受capacity类别；新生成不读取历史默认值。旧settings.capacity、请求快照与选题不迁移/删除；旧排队任务送模型前复制快照并剥离capacity_hours，原审计快照与输入版本保留。生成说明不再列出历史可用工时。

提示词yoyo-v1.2.5移除产能作为输入条件，并阻止把可用工时/每周产能继续列作缺口；版本与新输入隔离旧缓存。固定评估输入同步移除该值并升级s3-eval-v1.2.1。实际制作耗时与单条estimated_hours/null守卫独立保留，本轮不扩展制作或产能管理。

| 检查 | 结果与证据 |
|---|---|
| 相关后端 | [21项通过](api-targeted.log)：旧参数0/8/null均422，旧capacity设置写入422且无新请求；历史40小时配置保留但新快照不含该字段；旧队列模型输入剥离且审计保留；缺口守卫、展示与AI金额预算等 |
| 完整后端 | [198项通过](api-tests.log)，受控传输，无新增真实模型/采集调用 |
| 页面 | [2专项](browser-targeted.log)、[55完整页面](browser-tests.log)通过；旧每周配置夹具不显示、生成仅提交账号/栏目/窗口，AI预算仍可保存，保留账号/删除/来源/选题与监控等回归 |
| 契约 | [生成](contract-generate.log)、[校验](contract-check.log)、[结果](contract-validation.json)：75路径/90操作/137定义/39样例；新增旧工时参数与设置类别拒绝样例 |
| 构建 | [最终构建](build-evaluation.log)、[类型](typecheck-evaluation.log)、[源码Docker](docker-build-evaluation.log)通过；评估审计工具支持指定新报告路径，保留历史证据 |
| 合成视觉 | [生成手机](screenshots/generate-390.png)、[预算桌面](screenshots/budget-1440.png)，另有1440/390/320；显式隔离库夹具，不当实际模型质量证据 |
| 实际本地只读 | [结果](local-browser.json)、[最终日志](local-browser-final.log)：设置/生成各1440/1280/768/390/320无横溢出，两处输入退出，预算控件保持，2个历史生成说明无可用工时条目，0页面异常/0写请求；[生成](screenshots/local-generate-390.png)、[预算](screenshots/local-budget-1440.png)。截图输入值临时遮罩 |
| 部署/数据 | [最终更新](local-deploy-final.log)、[结果](local-runtime.json)、[日志](local-runtime-final.log)：仅no-deps更新API和worker；网页JS/CSS、API生成入口/校验和worker AI模块匹配已测编译，62业务表完整count/hash、默认身份/私有AI配置与41迁移保持 |

首次使用系统Python校验契约时缺少jsonschema，[原失败](contract-check-environment.log)保留；使用项目已有`.local/contract-validation`环境后通过，没有临时降低校验或增加依赖。历史93份截图从受限副本逐文件还原，原始日志私有保存，公开仅规范行末空白。

API/worker更新前general运行任务为0；网页3000/存储59001及其余服务、宿主浏览器桥接保持，S8测试服务停止/卷保留。回滚镜像`yoyo-local:change035-api-rollback`核对保留，沿用受限备份，无新备份。没有在实际实例新增业务记录、选题生成/采集/账号核验；真实AI调用仅在隔离测试库使用合成输入，也未提交/推送。

技术删除完成后的依赖检查发现，S11-03等DONE任务依赖S3-07；仅将新提示词质量标为待验不能通过原依赖规则。[中间检查](document-check-dependency-pending.log)保留；没有弱化检查，按07设计补跑当前固定20例真实模型并逐例技术评审。

新版本[实际输出](ai-evaluation-live.json)、[逐例评审](ai-evaluation-review.json)、[评审日志](ai-review.log)、[机器复核](ai-topics-validation.json)及[日志](ai-validation.log)全部通过：20例、21次真实请求（含1次允许的修复）、129409 token，费用unknown不记0。五维每项≥3、总分≥20，输出哈希绑定，事实摘录/ID/许可/注入/未知工时/过期等硬门槛通过。输入明确为合成来源/指标/攻击，评审者Codex，属于内部技术验收，不能冒充实际平台内容效果或使用者业务认可。

[四工作流合并审计](ai-quality-validation.json)及[日志](ai-quality-validation.log)复核新20例与未改提示词的既有7例报告/反馈/来源，共27例30请求167932 token；后7例没有重新调用，30不是本轮新增请求数。审计工具允许通过AI_TOPICS_REPORT/AI_TOPICS_REVIEW与结果路径选择新证据，未覆盖S8历史报告。

辅助评审脚本首次使用.mts导入当前CJS形状模块失败，[原日志](ai-review-first.log)与依赖其结果文件的[首次复核](ai-validation-first.log)/[合并复核](ai-quality-validation-first.log)保留；私有脚本改为与项目一致的.ts入口后通过，不涉及产品修改或重新调用模型。当前S3-07/T05恢复依据与发布门禁数量只维护于开发进度，完整发布仍未就绪。

复核新选题证据可运行：

```sh
AI_TOPICS_REPORT=docs/evidence/change035/ai-evaluation-live.json AI_TOPICS_REVIEW=docs/evidence/change035/ai-evaluation-review.json AI_TOPICS_VALIDATION_REPORT=docs/evidence/change035/ai-topics-validation.json pnpm exec tsx tools/s8/validate-topics.ts
```
