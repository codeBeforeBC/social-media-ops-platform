# BUG-042 登录账号未识别的解释与操作指引

2026-10-30；Codex；`/Users/junlong/projects/social-mdeida-ops-platform`，`codex/s9-acceptance`/`34317f8` 加未提交修改。CHANGE-027/028/029全部保留；实际状态仅见[开发进度](../../tracking/开发进度.md)，工作记录LOG-163/164。

症状：公开主页匹配后的“登录身份未确认”没有解释含义和具体下一步，用户难以分辨未登录、未识别与工具限制。实际只读摘要确认partial、公开matched、登录unknown、能力unknown、无错误、当前且未过期；未打印账号标识或读取平台会话。

根因：后台合法保留unknown。当前[识别器](../../../tools/s0/probe-xhs-account-identity.mjs)要求自己的主页入口与页面当前用户状态两份身份一致，证据未读全时不推断未登录；[适配器](../../../tools/s3/xhs-account-verify.mjs)可返回公开匹配但登录unknown且无错误。前端将这个结果仅表述为“登录身份未确认，请核对登录状态”，未解释识别与登录的区别，也没有检查浏览器/自己的主页/重试步骤。此轮修复的是展示指引，不假定已定位平台当前未识别的具体原因，也不修改识别结果。

修复：[验证面板](../../../apps/web/src/account-verification.tsx)把unknown表述为“未能识别当前登录账号”，明确不代表未登录。在当前公开匹配而登录未识别的结果内，常显检查所选验证浏览器、在该浏览器进入自己的主页核对目标、保持打开后重新验证三步。已登录仍未识别时只说明可能的信息未加载/页面变化，不伪造原因。未登录提示先登录、错号提示先切换且不替换登记账号、不支持时说明工具限制与人工核对，不承诺反复重试能解决；匹配、在途与过期/旧绑定不误显示当前登录补救指引。人工运营确认不替代登录验证或后台读取能力证明。原验证/声明/冷却/后台权限和服务端状态规则不变。

产物：[面板](../../../apps/web/src/account-verification.tsx)、[局部样式](../../../apps/web/src/style.css)、[页面回归](../../../tests/browser.spec.ts)、[交互基线](../../yoyo-workbench-v1.0/02-页面与交互规范.md)。无后台业务、接口契约、依赖或迁移变化。

| 检查 | 证据 |
|---|---|
| 先失败 | [红色回归](browser-red.log)，缺少登录验证指引而失败，复现原问题 |
| 多状态通过 | [绿色回归](browser-green.log)，8组状态：unknown、auth_required、mismatched、unsupported、能力不支持、matched、running、stale；0写请求及1440/390/320无横溢出 |
| 完整页面回归 | [47项通过](browser-tests.log)，包括原新增/保存关闭/运营确认/删除/历史/运行状态与审计及其他业务流程 |
| 构建 | [原生](build.log)、[类型](typecheck.log)、[Docker](docker-build.log) |
| 合成截图 | [桌面](screenshots/login-guidance-1440.png)、[390](screenshots/login-guidance-390.png)、[320](screenshots/login-guidance-320.png)；不是实际平台验证通过证据 |
| 实际页面只读 | [结果](local-browser.json)、[桌面](screenshots/local-verification-1440.png)、[390](screenshots/local-verification-390.png)、[320](screenshots/local-verification-320.png)；个人字段用临时浏览器样式遮罩 |
| 本地与数据 | [更新](local-deploy.log)、[核对](local-runtime.json)，62业务表count/hash、默认身份及私有AI配置保持，41迁移不变，部署资源与已测产物一致 |

首次绿色多状态用例在第二组状态复用了同URL和打开的弹窗，导致后面的列表按钮被弹窗遮挡；[原失败日志](browser-green-first.log)保留。修正为每组重新加载独立页面后通过；不是产品修复假设失败。完整回归会生成旧任务截图，执行前在私有目录保存并在结束后还原CHANGE-027/029历史截图，不覆盖既有交付证据。

只更新本地API前端，3000/59001、worker/media/scheduler、宿主桥接59025及dev依赖沿用；S8测试依赖最终停止且卷保留。回滚镜像`yoyo-local:bug042-api-rollback`已核对，沿用既有受限备份，无新数据备份。没有替用户真实验证/登录/换账号/确认管理/删除或发起真实模型/采集。真实unknown结果没有被改成matched；未重复后端/契约全套或真实提供方评估。未提交/推送，原发布门禁保持。
