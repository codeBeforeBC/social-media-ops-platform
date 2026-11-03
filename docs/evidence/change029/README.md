# CHANGE-029 账号验证与保存交互优化

2026-10-30；Codex；目录 `/Users/junlong/projects/social-mdeida-ops-platform`，分支 `codex/s9-acceptance`，基线 `34317f8` 加本轮未提交修改；CHANGE-027/028全部保留。状态只见[开发进度](../../tracking/开发进度.md)，[交互方案](../../plans/CHANGE-029-账号验证与保存交互优化.md)。

用户要求验证区按钮分层、减少底层信息和重排历史，并追加运营确认与保存备注区分、保存后关闭以感知成功。结果卡现在优先展示结论、昵称、主页/登录身份和最近时间；单一主验证入口，“验证所用浏览器/确认更换”按需展开。历史默认折叠为可读时间线，当前结果同步，不堆叠绑定版本、会话ID和多组执行时间。

人工确认区说明用于本工作区运营，仍须显式勾选和服务端新鲜身份匹配守卫。备注独立收起为“修改本地备注”，展开后“保存备注”，不改变账号身份或确认。添加、备注保存和运营确认成功关闭弹窗，在列表显示醒目且含义明确的提示；请求失败保留表单/选择。新增提示明确仅提交验证，不冒充验证通过；列表在在途验证期间自动更新，失败可恢复读取，终态停止，详情打开时沿用原面板轮询。验证操作提交中禁止关闭，避免返回时误关新开的账号。

产物：[验证面板](../../../apps/web/src/account-verification.tsx)、[账号页面](../../../apps/web/src/main.tsx)、[局部样式](../../../apps/web/src/style.css)、[页面回归](../../../tests/browser.spec.ts)、[交互基线](../../yoyo-workbench-v1.0/02-页面与交互规范.md)。无后台业务、接口契约、依赖或数据库迁移新增。

| 验证 | 证据及范围 |
|---|---|
| 前段完整页面 | [44项通过](browser-tests.log)，验证排版/历史及原业务回归；最后文案7项复验见[browser-final.log](browser-final.log) |
| 保存交互完整回归 | [46项通过](browser-save-close.log)，新增/备注/运营确认成功关闭、失败保留、在途列表恢复/终态停止，原账号/删除/运行状态/审计及其他业务页面 |
| 最终相关复验 | [11项通过](browser-final-save-close.log)，最终提交期间关闭保护和分区间距调整后，覆盖新增/身份/错号/冲突/隐藏刷新/历史/备注确认及列表轮询 |
| 构建与类型 | [原生构建](build-final.log)、[类型](typecheck-final.log)、[源码Docker](docker-final.log) |
| 受控布局截图 | [桌面操作分区](screenshots/account-actions-1440.png)、[320窄屏操作分区](screenshots/account-actions-320.png)、[桌面历史](screenshots/verification-history-1440.png)、[390历史](screenshots/verification-history-390.png)、[320历史](screenshots/verification-history-320.png)；全部显式合成夹具，非真实平台认证证据 |
| 本地实际只读 | [结果](local-browser.json)；既有账号结果/历史与键盘展开、浏览器和备注默认收起、明确保存备注、1440/390/320无横溢出、0页面错误/0写请求；[桌面](screenshots/local-verification-1440.png)、[390](screenshots/local-verification-390.png)、[320](screenshots/local-verification-320.png)、[备注](screenshots/local-note-320.png)，个人字段通过浏览器临时样式遮罩，未修改应用源码/业务数据 |
| 运行和数据保持 | [更新](local-deploy.log)、[核对](local-runtime.json)：62业务表完整count/hash、默认身份与私有AI配置保持，41迁移不变，部署JS/CSS及后端编译与已测产物一致 |

早期日志如实保留：[验证排版首轮42过2](browser-tests-first.log)为无关采集断言误替换及面板未挂载前打开浏览器设置的测试竞态；修正后44通过。[保存交互首轮39过7](browser-save-close-first.log)为新成功提示与加载/旧删除完成提示同时存在时测试定位歧义，按提示内容限定后46通过；没有把早期失败改写成成功。最后增加运营确认提交中的关闭保护后再跑相关用例。原始日志私有保留，公开仅规范行末/结尾空白。

仅no-deps更新本地API前端；3000/59001与41迁移，worker/media/scheduler、宿主桥接59025和dev依赖保持。回滚镜像 `yoyo-local:change029-api-rollback` 已验证，沿用已有受限备份，无新数据备份；S8测试服务最终停止且卷保留。没有新增/验证/确认/删除实际用户账号，没有真实模型/来源/平台写入。仅前端变更，未重复后端/契约全套、实际提供方评估或旧发布演练；此前CHANGE-028的187后端属于其原范围。尚未提交/推送，原发布门禁保持。
