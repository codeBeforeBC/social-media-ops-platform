# CHANGE-027 运行状态信息层级重设计

2026-10-29；Codex；目录 `/Users/junlong/projects/social-mdeida-ops-platform`，分支 `codex/s9-acceptance`，基线 `34317f8`，开工工作区干净。实际任务状态只见[开发进度](../../tracking/开发进度.md)。

用户确认“异常与待处理事项优先”。[设计说明](../../plans/CHANGE-027-运行状态页面重设计.md)明确四层：问题与下一步入口→当前任务/进程→AI用量→来源连接。沿用现有绿色与系统字体，异常用文字和琥珀色提示，移除单一承载全部内容的大白框；历史分布、进程标识/完整响应时间、费用明细及来源配额按需展开。宽屏任务/进程并列，小屏单列，主要操作/展开项44px、长名称换行、明细表只在具名区域内横滚。

实现：[Monitor组件](../../../apps/web/src/operations.tsx)、[局部样式](../../../apps/web/src/style.css)、[页面容器](../../../apps/web/src/main.tsx)、[浏览器验证](../../../tests/browser.spec.ts)。不新增接口/依赖/迁移/图表或自动刷新，不改预算/采集/任务业务规则。保留BUG-041的页签隔离和请求失败重试。

表达边界：历史失败不计入运行中；等待/待分发不自动报故障；无心跳不能显示假正常；关闭定时/禁用AI不单独误报故障；AI启用不证明调用连通，OCR需人工核对。未知用量/费用保留未知，按币种展示原始费用小数；token聚合使用整数精度，超过JS安全整数的值不截断。不制造趋势或费用总额。

| 验证 | 证据 |
|---|---|
| 全页面回归 | [40项通过](browser-tests.log)，含账号删除及原监控/审计生命周期回归 |
| 最终源码复验 | [8项通过](browser-final.log)，最后补充安全整数外token精度，覆盖正常/异常/空心跳/未知与多币种、刷新、键盘、直接切页、迟到响应、503重试及预算/任务/来源入口 |
| 构建 | [原生构建](build.log)、[类型](typecheck.log)、[源码Docker](docker-build.log)通过 |
| 四宽度 | 受控异常截图：[1440](screenshots/attention-1440.png)、[768](screenshots/attention-768.png)、[390](screenshots/attention-390.png)、[320](screenshots/attention-320.png)；该状态明确为合成数据，不是真实告警 |
| 实际页面 | [1440](screenshots/local-1440.png)、[768](screenshots/local-768.png)、[390](screenshots/local-390.png)、[320](screenshots/local-320.png)；[只读验证](local-browser.json)为0写请求/0页面错误、历史默认折叠/键盘展开/监控审计直接往返通过，实际名称遮罩 |
| 本地更新 | [API容器更新](local-deploy.log)、[资源与数据核对](local-runtime.json)：62业务表count/hash、默认身份、私有AI配置保持；41迁移不变，JS/CSS/后端编译与已测产物一致 |

首轮新增用例2项通过，1项因定位器误包含aria-hidden装饰箭头而找不到按钮；[首次日志](browser-targeted-first.log)保留，按真实可访问名称修正后40全量和8最终复验通过，不将初次失败改写为通过。日志仅规范行末/结尾空白，原日志私有保留。未重复未受影响的全后端/契约套件，未进行真实模型/来源采集/平台调用。

本地只no-deps更新API以提供前端；网页3000/存储59001，worker/media/scheduler、宿主桥接59025及dev依赖保持；S8临时测试服务最终停止、卷保留。回滚镜像 `yoyo-local:change027-api-rollback` 已验证，沿用已有受限备份，无新数据备份/账号删除。未提交或推送；本轮没有新增自动告警/持续轮询/一键修复，仍以手动刷新时的真实快照为准。
