# YOYO 运营工作台

内部运营系统。当前实现 S1 基础工程与 S2 PNG 资产库：首次设置、内部账号与组合角色、运营账号、版本/幂等控制、持久任务、个人通知、审计和六导航页面外壳。支持 PNG 素材/渲染图上传与续传、私有原件、透明预览、目录搜索收藏、不可变版本与使用范围确认、来源关联和 PDF 品牌规范分页/人工激活。真实来源、AI、制作审核、日历及指标在后续阶段实现。素材其他格式按 CHANGE-002 移到下版；品牌规范保留 PDF。

## 本地启动

安装 Git 和支持 Compose 的 Docker 运行环境（Mac/Windows 默认 Docker Desktop；Linux 使用 Engine 和 Compose 插件），启动 Docker。普通使用者无需安装 Node、pnpm 或 PostgreSQL。

```sh
git clone <本项目仓库地址>
cd social-mdeida-ops-platform
cp .env.example .env
docker compose up -d --build
```

打开 `http://localhost:3000`。首次源码构建会下载基础镜像和锁定依赖，需要联网；固定版本预构建发布镜像将在 S9 提供，目前不填写不存在的镜像仓库。默认仅本机端口可访问，数据库无公开端口。

获取实例专属初始化凭据（这是显式显示凭据的管理命令，请勿把输出分享在日志/截图中）：

```sh
docker compose exec api node dist/tools/setup-token.js
```

在首次设置页面填写凭据、工作区名称、管理员姓名/邮箱以及至少12位密码。初始化成功后入口关闭，命令也不再返回凭据。没有公共默认密码、公开注册或自动发送邮件。成员由管理员创建邀请，通过自主选择的渠道交付凭据，成员在登录页选择“我有成员邀请”设置内部密码；邀请有效期24小时且仅使用一次。

如3000端口被占用，在 `.env` 同时修改 `YOYO_PORT` 与 `APP_ORIGIN`，例如3100和 `http://localhost:3100`，然后重新启动。浏览器访问地址必须与 `APP_ORIGIN` 完全一致（localhost和127.0.0.1不同），否则写操作会被Origin守卫拒绝。生产HTTPS部署使用 `NODE_ENV=production` 和实际HTTPS Origin；本地HTTP的开发Cookie例外仅用于本地。

## 日常运行与数据

```sh
docker compose ps
docker compose logs --tail=100 api worker reminder media media-executor scheduler
docker compose stop
docker compose up -d
```

PostgreSQL、对象文件和内部凭据分别在持久卷保存，普通停止/重启/容器重建保留数据。**不要使用 `docker compose down -v` 作为日常停止命令**，它会删除数据卷。迁移由独立migrate服务在应用启动前受控执行；已执行脚本校验和不一致会拒绝启动。

升级前备份数据库与实例凭据，源码升级后执行 `docker compose up -d --build`；有损迁移不自动实施，应用回滚不代表数据库可直接降级。S9将补齐完整备份恢复与版本回滚工具/演练，备份必须同时覆盖 objects 文件卷与内部凭据 state 卷。

基础数据库备份（输出含内部业务数据，保存在受限目录，勿提交仓库）：

```sh
docker compose exec -T db pg_dump -U yoyo -Fc yoyo > yoyo-db.dump
```

实例凭据的state卷也需要受限备份，不能通过重新生成密钥替代恢复；邀请幂等响应使用实例密钥加密保存。最低内存/磁盘、Mac/Windows/Linux兼容性与首次启动耗时在S9测量；当前提供S1/S2实测环境记录，不承诺未经验证的资源要求。

## 开发者原生入口

使用 Node 24、pnpm 10.33.0。开发前后端可以原生运行，数据库可使用Compose或独立兼容实例：

```sh
cp .env.example .env
docker compose -f compose.yaml -f compose.dev.yaml up -d db storage media-executor
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm exec tsx tools/storage-init.ts
pnpm setup-token
pnpm dev
```

普通Compose使用 `yoyo-workbench` 项目，开发Compose使用独立的 `yoyo-dev` 项目和数据库卷，避免两种入口混用凭据或数据。开发Compose把实例凭据写入忽略目录 `.local/state`，向本机暴露数据库54329、私有对象59000、媒体执行器59010端口。前端为 `http://localhost:5173`；**原生开发在 `.env` 将 `APP_ORIGIN` 改为 `http://localhost:5173`**，Vite代理 `/api` 到3000。原生开发另设 `MEDIA_ENDPOINT=http://127.0.0.1:59010`，并将 `S3_PUBLIC_ENDPOINT=http://localhost:59000`；签名地址须可从浏览器访问。也可构建后直接 `node dist/apps/api/src/main.js` 在3000访问。`pnpm worker`、`WORKER_POOL=reminder pnpm worker` 和 `pnpm scheduler` 分别运行一般池、提醒池与调度进程；`WORKER_POOL=media pnpm worker`运行媒体池；`pnpm dev`统一启动这些进程和前后端。

自行准备数据库时显式配置 `DATABASE_URL`，并运行 `STATE_DIR=.local/state node tools/init-state.mjs` 创建持久内部凭据。迁移源为 `packages/db/migrations/*.sql`，Prisma Schema反映关系；CHECK、部分索引、行锁和审计触发器由SQL负责。禁止用 `prisma db push` 替代迁移。

## 验证

测试使用独立名称以 `_test` 结尾的数据库，启动使用实例时不自动写入测试种子。首次本地准备测试数据库：

```sh
docker compose -f compose.yaml -f compose.dev.yaml exec -T db psql -U yoyo -d postgres -c 'CREATE DATABASE yoyo_test'
pnpm exec playwright install chromium
pnpm check:s2
```

`pnpm check:s2`准备独立的 `yoyo-s2-tests` 对象存储与解析器（59020/59030），运行构建、前后端类型检查、真实PostgreSQL/S3/HTTP集成与浏览器测试；凭据、对象与使用实例分离。`pnpm check`适用于已显式配置存储/解析器的环境。测试脚本从本地受限凭据构造开发测试连接；CI/外部数据库显式设置 `TEST_DATABASE_URL`（必须 `_test` 后缀），`STATE_DIR`指定实例凭据目录。测试会清空该测试库数据，不连接使用实例数据库。

浏览器测试使用独立3001端口，包含首次设置、表单、六导航、键盘抽屉、空/错/加载、登录过期与1440/1280/390布局。CI定义见 `.github/workflows/ci.yml`；本地执行不代表已经在托管CI运行。验收事实见 [S1证据](docs/evidence/s1/README.md) 与 [S2证据](docs/evidence/s2/README.md)，开发状态以 [任务台账](docs/tracking/开发进度.md) 为准。

## 外部能力与排障

AI/OCR没有默认密钥或预算，来源没有默认账号凭据。未来按需配置后启用；当前小红书验证路径仍依赖宿主机浏览器、Bridge和人工登录，Compose不会接管登录态，S3将实现运行连接与故障恢复。未接通来源不影响S1内部账号、设置和运行检查。

- Docker未运行：先启动运行环境，使用 `docker info` 核验。
- 镜像/依赖下载中断：检查网络后重新构建，保留数据卷；不改用不明来源镜像。
- 服务未就绪：查看 `docker compose ps -a` 与migrate日志，区分依赖健康、迁移、应用失败；不跳过失败迁移。
- 写操作403：核对浏览器地址与APP_ORIGIN、刷新CSRF、当前成员角色。401须重新登录。
- 版本冲突409：重新加载当前对象后确认修改，不静默覆盖。
- 后台任务失败：管理员在设置→后台任务查看错误和请求编号，可填写原因重试；输入过期结果不会自动覆盖当前版本。
- 本地电脑休眠/服务停止：持续任务暂停；进程恢复后重新领取过期租约。提醒与重型任务使用独立池，站内已读不代表业务完成。

## PNG 与品牌规范使用

在 IP 资产库上传 PNG（单文件最大 2 GiB、两个并发分片上传）。暂停或关闭页面后重新选择同一文件即可查询已完成分片并续传；取消会清理未完成分片。PNG 解码上限为一亿像素。透明预览保留 alpha；原件与预览分别保存，不以预览替代原件下载。只读成员可预览，原件下载需要独立权限，签名地址五分钟过期。

原件保存成功后，后台隔离解析器生成预览。确认素材使用范围会新增版本；替换文件也新增版本，历史内容引用保持原版本。停用填写理由并禁止新增引用。页面中的来源/衍生选择器绑定具体版本；内容制作界面在 S4 接入同一引用接口。测试规则与合成媒体仅存在于独立测试库，不构成品牌使用授权。

品牌规范页单独上传 PDF，解析完成后选择规范原件，按 PDF 页序逐条录入规则。草稿不会自动生效，审核成员须填写核对依据后激活；新版本激活会退休旧规范，运营策略建议与官方规则分开。PDF 解析最多 2000 页；已有 37 页约410 MB规范已实测。损坏或越限文件不能作为可用素材；解析服务故障可重试，不丢失原件。

对象存储的公开端口默认仅绑定本机，凭据由实例初始化持久保存。修改 `S3_PORT` 时同步修改浏览器可达的 `S3_PUBLIC_ENDPOINT`，然后重新启动服务。解析器只有专用任务 token，没有数据库或 S3 凭据；解码子进程通过 Landlock/seccomp 禁止网络和凭据读取。
