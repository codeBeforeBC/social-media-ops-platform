# S2 PNG 资产与 PDF 品牌规范验收

验收日期：2026-10-07（Asia/Shanghai）。按用户明确确认的 [CHANGE-002 / ADR-004](../../decisions/ADR-004-S2首版PNG素材范围.md)：本版素材仅支持 PNG，品牌规范保留已有 PDF。其他素材格式属于下版；未以工程或音视频缺失阻塞本版，也未宣称已支持它们。

工作目录 `/Users/junlong/projects/social-mdeida-ops-platform`，main，基线 `9318c3a`，本轮工作树修改未提交、未推送、未发布。实现及锁定依赖见 [源码校验清单](source-manifest.json)，实际镜像/环境见 [环境记录](environment.json)。任务状态只维护于 [开发进度](../../tracking/开发进度.md)。

## 任务与证据

| 任务 | 本版通过内容 | 验证证据 |
|---|---|---|
| S2-01 | 私有真实 S3、8 MiB 分片、2 GiB 上限、重复分片/断点查询、取消与过期清理、完整哈希/大小校验、同空间去重、跨空间404、角色下载权限、五分钟签名 | [全量检查](check.log)、[重启与签名失效](persistence.json)、[重启日志](persistence.log) |
| S2-02 | PNG 验证/透明缩略图、PDF 全页预览/文本，原件与衍生文件分开；损坏 PNG 隔离；解析器没有数据库/S3凭据，子进程网络/凭据访问失败且只可写自己的目录 | [真实PNG](real-png.json)、[真实PDF](real-pdf.json)、[沙箱实测](sandbox.json)、[默认Compose](compose-smoke.json) |
| S2-03 | PNG素材/渲染图分类、层级文件夹与循环拒绝、标签/名称/IP/系列检索、收藏、两个并发上传、详情、响应式界面、复用具体版本选择器 | [集成检查](check.log)、[浏览器5流程](browser.log)、[截图目录](screenshots/) |
| S2-04 | 人工使用范围确认新增不可变版本、替换文件保留旧引用、停用留因并拒绝新内容引用、来源/衍生双向关系、内容版本引用API与账号权限隔离 | [集成检查](check.log)、[浏览器双向关联](browser.log)、[数据库迁移](../../../packages/db/migrations/005-assets.sql) |
| S2-05 | 已有PDF保留，页序/文本可阅读检索，规则逐条录入与页码边界，草稿人工激活/旧规范退休及审计，官方规则与运营提案分表 | [真实PDF规则验收](real-pdf.json)、[浏览器规则流程](browser.log)、[默认Compose联调](compose-smoke.json) |
| S2-06 | 真实PNG和410 MB规范PDF、中文名、断点/登录恢复、原件哈希、失败/越限、只读预览、越权、旧版本与停用回归 | [真实PDF运行](pdf-test.log)、[真实PNG](real-png.json)、[重启验收](persistence.json)、全量检查 |

## 实际执行

- `pnpm check:s2`：构建、前后端类型检查、23项真实PostgreSQL/S3/HTTP集成测试、5项Chromium浏览器流程全部通过，无跳过；[日志](check.log)。随后针对图片实际解码与静态站点安全策略调整复验5个浏览器流程，[日志](browser.log)。
- `node tools/s2/check.mjs node tools/test-env.mjs pnpm exec tsx --test tests/s2-persistence.test.ts`：1项通过，实际重启API/S3并重建S3容器；已传分片、会话、原件SHA-256与凭据保留。额外一秒期限签名等待过期及篡改签名均403，没有在日志保存签名URL。
- `S2_REAL_PDF=<已有PDF本地路径> node tools/s2/check.mjs node tools/test-env.mjs pnpm exec tsx --test tests/pdf.test.ts`：1项真实大PDF验收通过，约45秒测试本体；原件409,861,466字节，SHA-256 `10d26b58362e2a229df363996f367e10fb27c7815f57bfe696230a27c937fbd7`，37页全部预览，提取50,213字符。在第三分片退出并重新登录后续传；下载校验、页38越界、人工激活/换版、只读预览及拒绝原件下载均通过。
- 默认Compose专用 `yoyo-s2-smoke` 实例源码构建/迁移/依赖启动通过；运行 `node tools/s2/compose-smoke.mjs`，API→真实存储→Outbox→独立媒体池→内部网络解析器→预览/原件下载→规范激活全链路通过；真实Chromium在默认静态页面加载预览像素，验证配置存储Origin在图片安全策略内。[构建日志](compose-build.log)、[结果](compose-smoke.json)、[浏览器截图](screenshots/compose-real-preview.png)。
- 冻结契约通过124操作与21个JSON Schema样例；API集成客户端对已实现操作的实际响应校验。[契约结果](contract-validation.json)、[日志](contract-validation.log)。SQL008已迁移且Prisma生成通过，部分唯一索引/不可变触发器由SQL保留。

测试使用专用 `_test` 数据库、`yoyo-s2-tests` 对象/临时卷与单独凭据（59020/59030）。默认启动演练使用独立 `yoyo-s2-smoke`（3012/59040），没有向使用实例写种子。真实样本只用于这些隔离验收实例；合成PNG/PDF、规则和内容修订均明确为测试数据。

## 样本与边界

真实PNG为仓库已有品牌参考 `references/brand/page-17.png`，296,052字节、2304×1296、无alpha；原件下载字节一致。透明通道另外用明确标记的2×2 RGBA合成PNG测试实际解码与预览；没有将它描述为团队真实透明源素材。重启大分片测试的PNG签名加填充只验证存储，不作为格式兼容证据。真实PDF原件来自此前已提供的本地手册，不复制大文件入仓库。

S2已实现内容引用的关系/API/不可变与权限约束；S4内容制作页面和真实发布链路仍待实施。本版未调用AI、未自动生成或自动激活品牌规则，也未确认任何生产素材授权。正式素材来源和允许使用范围继续由有权成员录入确认，测试确认不等于生产授权。

本轮在macOS arm64宿主机、Docker Linux arm64内核、Node24.14.1/pnpm10.33.0实测；未宣称托管CI、其他架构/干净系统、镜像发布或S9备份恢复通过。T01–T24为全产品发布门禁，S2通过不关闭依赖S3–S9的整体门禁。所有验收/演练容器结束后停止，保留卷；开发数据库与原生媒体开发依赖保留供续接。
