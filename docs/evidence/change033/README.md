# CHANGE-033 新增来源表单重设计

2026-10-30；Codex；`/Users/junlong/projects/social-mdeida-ops-platform`，`codex/s9-acceptance`/`34317f8`加既有及本轮未提交修改。任务事实仅见[开发进度](../../tracking/开发进度.md)，布局约定见[设计](../../plans/CHANGE-033-新增来源表单按类型重设计.md)。

[新增来源](../../../apps/web/src/source-create.tsx)先选类型，再填写有效配置。微博只有类型/名称；小红书使用现有浏览器选择列表，解释连接标识而非平台账号ID，并明确逐词搜索用途/分隔与上限。参考笔记可选最多2个完整账号主页，规范化为24位ID且丢弃链接参数；说明额外账号笔记不按关键词过滤、不加入运营账号列表。话题与参考笔记的搜索排序/正文能力分别说明。

固定标题和单一添加按钮、中间滚动；隐藏草稿不提交。创建仅保存配置、定时关闭，说明列表人工采集入口与原定时时间。成功关闭并明确尚未采集；失败可见且保留输入，忙碌禁用修改/关闭。复用现有浏览器字段及账号ID解析，无新依赖/API/契约/迁移，来源调度及采集逻辑不变。

| 检查 | 结果与证据 |
|---|---|
| 专项 | [首轮5项](browser-targeted.log)、[最终5项](browser-final.log)，含必要前置/原来源保存、新3类字段切换、隐藏值排除、关键词/参考主页校验、忙碌/503保留与重试、浏览器连接失败与刷新恢复 |
| 完整页面 | [54项通过](browser-tests.log)，覆盖保留的账号/删除/运行审计、采集反馈、来源整理及候选选题等 |
| 构建 | [最终构建](build-final.log)、[类型](typecheck-final.log)、[Docker](docker-build-final.log)通过；完整54后仅明确“参考笔记不按关键词过滤”，随后最终5项复验 |
| 合成视觉 | 三类型各1440/1280/768/390/320；例如[微博](screenshots/source-create-weibo-1440.png)、[话题](screenshots/source-create-search-390.png)、[参考主页](screenshots/source-reference-help-320.png)。合成浏览器与主页，仅隔离测试库写入，不是实际平台采集/认证证据 |
| 实际只读 | [结果](local-browser.json)、[日志](local-browser.log)：三类型五宽度无横溢出、标题与底部按钮可见、Esc焦点返回，0页面异常/0写请求；[微博](screenshots/local-weibo_hot-1440.png)、[参考说明](screenshots/local-reference-help-320.png)。真实浏览器选择值遮罩；现场浏览器发现返回连接/验证提示，未确认可用的实际浏览器选项，正常列表/刷新/提交分支由合成测试覆盖 |
| 运行与数据保持 | [更新](local-deploy.log)、[结果](local-runtime.json)、[日志](local-runtime.log)：当前JS/CSS及保留后端模块匹配已测产物，62业务表完整count/hash、默认身份/私有AI配置保持，41迁移无新增 |

续接时Docker守护进程停止，导致最后复验[数据库连接失败](browser-final-environment-unavailable.log)及[镜像连接失败](docker-build-final-environment-unavailable.log)。重新启动Docker并恢复既有依赖后同一检查通过，原失败日志保留。没有通过修改产品绕过环境问题。

仅no-deps更新本地API；3000/59001及worker/media/scheduler恢复运行，dev依赖保持；宿主桥接未修改，浏览器连接需使用者自行恢复，未代操作认证。S8测试服务已停止、卷保留。回滚镜像`yoyo-local:change033-api-rollback`已核对，沿用受限备份，无新数据备份。先前CHANGE-027/029/BUG-042/031/032截图61份从私有副本逐文件还原；原始日志私有保留，公开规范行末空白。没有新增实际来源配置、触发真实采集/账号验证/模型调用；前端调整未重复后端/契约全套，未提交/推送，原发布门禁保持。
