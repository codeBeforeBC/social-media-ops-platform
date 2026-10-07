# S1 基础工程验收证据

日期：2026-10-07（Asia/Shanghai）。执行者：Codex。工作目录 `/Users/junlong/projects/social-mdeida-ops-platform`，main，基线 HEAD `c0e554bbbb7d091b204e052126373c8b88da3f95`；本轮应用和文档修改未提交、未推送、未发布。源文件校验清单见 [source-manifest.json](source-manifest.json)，对应镜像ID见 [compose-smoke.json](compose-smoke.json)。

环境：macOS/Darwin arm64，Node 24.14.1、pnpm 10.33.0、Docker Desktop/Engine 29.6.2；PostgreSQL 17.6。测试与浏览器均使用专用 `yoyo_test` 数据库；容器演练使用独立 `yoyo-s1-smoke` 项目、3100端口及合成身份，不向普通使用实例注入测试种子。普通入口 `yoyo-workbench` 与原生开发 `yoyo-dev` 使用不同数据库和凭据位置。

## 完成判据与实证

| 任务 | 产物 | 对应验证 |
|---|---|---|
| S1-01 工程与CI | 根package/pnpm锁、workspace、TypeScript、`.env.example`、Dockerfile、Compose、原生开发工具、CI工作流、[启动说明](../../../README.md) | 冻结依赖安装、前后端构建/类型检查通过；两个Compose配置通过；源码镜像构建通过，容器内运行不需要宿主Node。CI对应命令本地通过，尚无托管CI运行记录 |
| S1-02 数据库迁移 | `packages/db/prisma/schema.prisma`、3份SQL迁移、校验和与advisory lock迁移器、DB健康检查/数据卷 | 真实PostgreSQL建模/外键校验，测试数据库隔离；容器停止、启动、重建和重复迁移保留账号与版本，凭据不变 |
| S1-03 身份与权限 | 首次设置、Argon2id、Cookie会话、CSRF/Origin、成员邀请、实时组合角色/空间/账号/字段守卫 | 首次设置错误凭据与Origin/CSRF拒绝、并发只建一个管理员；登录轮换、退出、绝对/闲置过期、登录限流；跨空间/账号、字段注入、只读写入/原件下载拒绝；停用与角色变更即时生效 |
| S1-04 API协议 | 错误信封、请求编号、稳定游标、事务幂等、expected_version | 同键6并发同一结果、异载荷409、并发版本仅一次写入；游标分页/非法参数；实际HTTP响应逐次按OpenAPI校验；幂等结果跨容器重启保留 |
| S1-05 Job/Outbox | 事务事件、SKIP LOCKED、租约/心跳、退避/取消/超时、过期输入保护、调度与worker | 回滚无事件、并发分发/领取去重；真实领取子进程SIGKILL后恢复、旧租约不能提交；长任务跨初始租约，超时/取消/过期版本无迟到副作用；退避上限与管理员重试 |
| S1-06 通知/审计/监控 | 个人通知、只追加审计触发器、请求关联日志、任务错误与运行监控、独立提醒进程 | 个人通知越权404、已读不改其他人；数据库拒绝审计UPDATE/DELETE；审计无密码/邀请；普通池占用时提醒成功；真实容器一般/提醒任务和3池健康通过，Compose配置独立CPU/内存限制 |
| S1-07 页面外壳 | React六导航、设置与账号/成员/任务页、公共表单/表格/抽屉、空错加载态 | 2条真实浏览器流程通过；首次设置、表单保存、六入口、Escape关闭/焦点恢复、退出、可重试错误/加载/401；1440/1280/390无页面横向溢出，截图人工检查 |

## 命令与结果

```sh
pnpm install --frozen-lockfile
pnpm check
node tools/test-env.mjs pnpm exec playwright test
docker compose config --quiet
docker compose -f compose.yaml -f compose.dev.yaml config --quiet
docker compose build
node tools/s1/smoke-compose.mjs
CONTRACT_VALIDATION_REPORT=docs/evidence/s1/contract-validation.json /tmp/yoyo-s0-validation/bin/python tools/s0/validate-contracts.py
```

构建及类型检查通过；19项数据库/HTTP/任务/权限测试全部通过；2项浏览器流程通过。容器演练7个检查点通过，详见 [Compose报告](compose-smoke.json)。原始脱敏结果保存为 [check.log](check.log)、[browser.log](browser.log)、[docker-build.log](docker-build.log)、[compose-smoke.log](compose-smoke.log)。Schema验证119操作与21合成样例通过，见 [contract-validation.json](contract-validation.json)；该报告本身不证明运行通过。

截图：[1440](screenshots/home-1440.png)、[1280](screenshots/home-1280.png)、[390](screenshots/home-390.png)。截图使用合成身份和明确未接入状态，不是业务来源或涨粉证据。

## 范围与未执行项

S1提供可靠底座及真实诊断任务，六导航中的后续业务页面明确待接入。文件签名下载/媒体沙箱在S2，来源与AI在S3，制作、活动和指标按后续阶段实现；当前只验证S1权限守卫，不能据此宣称真实文件下载验收通过。

尚未执行托管GitHub CI、linux/amd64运行、Windows/Linux干净机器首次安装、预构建镜像发布、完整备份恢复/兼容升级及最低资源测量；这些完整交付验收归S9，源码构建及当前arm64运行不冒充多架构验证。S0真实来源/样本/服务缺口仍保留，T01–T24整体发布门禁仍NOT_RUN，本报告不关闭产品发布门禁。

运行交接：测试容器演练结束后停止专用 `yoyo-s1-smoke` 服务，保留测试卷；原生开发数据库 `yoyo-dev` 保留运行供续接，旧项目 `yoyo` 已停止且未删除卷。没有来源自动采集、外部AI调用、推送或部署发布。
