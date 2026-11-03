# CHANGE-032 来源证据面板重设计

2026-10-30；Codex；`/Users/junlong/projects/social-mdeida-ops-platform`，`codex/s9-acceptance`/`34317f8`加既有未提交修改。状态仅见[开发进度](../../tracking/开发进度.md)，布局约定见[设计](../../plans/CHANGE-032-来源证据面板排版与分页设计.md)。

[SourceFeed](../../../apps/web/src/sources.tsx)现在按标题/刷新、分组筛选、紧凑卡片、独立分页底栏排列；桌面双列、手机单列，修正标题按钮的大间距，突出标题并弱化来源/连接健康/时间。小红书摘要预览两行且详情保留全文；微博正文与发布时间隐藏规则不变。底栏显示当前筛选实际已加载条数，有更多、加载中、失败原位重试与结束状态各自明确。

AI来源整理成为相邻独立面板，保留同一items及原前20条输入和人工采纳流程。追加失败不清空前页，首次失败不冒充空结果，快筛迟到响应不覆盖新筛选；没有增加采集/模型调用或修改来源数据规则。只有前端/局部样式及相关页面用例变化，无API、契约、迁移或依赖变化。

| 检查 | 证据 |
|---|---|
| 相关页面 | [6项通过](browser-targeted.log)：必要前置、原来源详情/微博与小红书区别、新分页结构与失败重试/去重、首次失败/筛选竞态 |
| 完整页面 | [51项通过](browser-tests.log)，含既有采集进度自动刷新、来源整理、候选列表/账号/删除/运行与审计等保留业务 |
| 最终复验 | [6项通过](browser-final.log)，统一搜索输入样式及补充有更多状态截图后复验 |
| 构建 | [原生](build.log)、[类型](typecheck.log)、[源码Docker](docker-build.log) |
| 合成视觉 | 有更多：[桌面](screenshots/source-pagination-1440.png)、[手机](screenshots/source-pagination-390.png)；完成状态：[1440](screenshots/source-panel-1440.png)、[1280](screenshots/source-panel-1280.png)、[768](screenshots/source-panel-768.png)、[390](screenshots/source-panel-390.png)、[320](screenshots/source-panel-320.png)。显式合成夹具，不是实际平台采集证据 |
| 本地实际只读 | [结果](local-browser.json)：五宽度无横溢出，双列/单列正确，分页始终在线索面板内部、与独立整理面板间隔24px；150条实际记录从20逐页加载到150，7次追加后结束，标题键盘详情/Esc焦点返回，0错误/0写请求；[桌面底栏](screenshots/local-pagination-1440.png)、[手机底栏](screenshots/local-pagination-390.png)、[结束](screenshots/local-pagination-complete.png)。标题/名称/摘要用临时浏览器样式遮罩 |
| 运行数据 | [更新](local-deploy.log)、[核对](local-runtime.json)：部署JS/CSS及原后端编译与已测产物一致；62业务表完整count/hash、默认身份/私有AI配置和41迁移保持 |

实际只读脚本首次将分页上限误设为5次，面对150条记录在未完成时主动退出；[原日志](local-browser-first.log)保留。逐页GET确认每页20条新记录、游标持续前进，无重复页或产品分页故障；改用捕获的实际记录数限定检查范围后完整加载结束。没有通过修改产品或删数据绕过该检查。

仅no-deps更新本地API前端；3000/59001、worker/media/scheduler、宿主桥接59025及dev依赖保持，S8测试服务停止/卷保留，回滚镜像`yoyo-local:change032-api-rollback`已核对，沿用受限备份，无新数据备份。原历史截图从私有副本还原，原始日志另存私有目录，公开仅规范行末空白。没有触发真实采集、AI整理或选题操作；未重复后端/契约全套，未提交/推送，原发布门禁保持。
