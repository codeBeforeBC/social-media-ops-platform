# CHANGE-034 浏览器连接复查与恢复

2026-10-31；Codex；`/Users/junlong/projects/social-mdeida-ops-platform`，`codex/s9-acceptance`/`34317f8`加全部既有未提交修改。状态只见[开发进度](../../tracking/开发进度.md)，复发操作见[恢复指南](../../runbooks/浏览器连接恢复.md)。

实际发现工作台health200，但`GET /account-browser-profiles`503、`BROWSER_UNAVAILABLE`；宿主59025无监听，项目固定OpenCLI daemon状态stopped、已连接档案0。由本地代码追踪确认profiles依赖宿主source-bridge，再读取OpenCLI daemon状态；这是两个宿主连接进程未运行，并不能据此断言小红书已退出登录。

恢复现有OpenCLI1.8.8 daemon和source-bridge，保持默认127.0.0.1监听与已有令牌，未重置凭据、重建来源或更换浏览器。启动初始状态no-extension，随后既有Chrome插件自动重连。主进程与日志路径私有记录于`.local/change034/`，未添加开机自启配置。

[实际检查结果](connection-check.json)：宿主鉴权健康/档案列表与工作台档案接口均200，读到1个浏览器；无鉴权桥接请求仍401，未放松访问控制。实际页面“添加来源→小红书话题搜索”能展示浏览器选项，刷新/关闭正常，0页面错误、0业务写请求。公开证据仅含连接数量和状态，不记录档案ID、账号、Cookie或令牌。

没有更改产品代码、API/契约、数据库迁移、账号或来源配置，也没有发起平台登录、真实采集/账号核验或模型调用。因此不运行构建/全套产品测试，也不把连接恢复当实际采集/登录身份已验证。文档检查单独记录于台账；未提交/推送，原发布门禁保持。
