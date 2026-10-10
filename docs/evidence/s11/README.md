# S11与四项重验执行证据

2026-10-09，Codex，工作目录`/Users/junlong/projects/social-mdeida-ops-platform`，main基于e4bd051。实施中，尚未宣称验收通过。

- [实际实例盘点](inventory.json)：本机5个持久数据库实例、7个数据库的脱敏数量/历史任务及备份SHA256。备份原件在受限忽略目录`.local/s11-backups`，不提交业务数据/凭据。停止实例仅启数据库用于读取后恢复停止，不启业务服务。
- 当前旧库并非空：开发测试库5篇旧笔记、S3副本6题及2次采纳、S2副本真实文件引用均保留。
- 原开发库yoyo尚未升级/部署；兼容迁移仅在隔离库验证。
- 首次盘点yoyo-db因54329端口冲突不能直接启动，使用无发布端口的临时容器；同PG17 Alpine产生collation警告，只读备份未改变schema，恢复演练将使用原17.6-bookworm镜像。
- S0-05真实后台样本缺失仍阻塞；合成导入样本与实际提供方评估分开标识。

## 当前产物与已执行验证（最终质量仍待收口）

- 三导航与旧深链回退、采纳唯一TopicDecision、独立Publication及import_screenshot/import_table/source_evidence边界；生产/资产/日历/活动 API/前端/领域/worker/生成工具/测试和reminder运行入口已删除，SQL001–024及历史证据保留。资产/规范专属依赖poppler/字体退出，Pillow/CSV/OOXML安全解析继续使用Landlock/Seccomp/资源限制。
- [当前契约](contract-validation.json)：64路径/78操作/109Schema，26正反样例；AI候选及输出直接从网关Zod生成，implemented HTTP响应逐次核对。planned为S7/S8目标，不算已接入。
- [迁移验证](migration-verification.json)：7份本机实际备份升级副本与新库001–026、重复运行通过；Publication身份、文件ID/键/哈希、16张迁出历史表数量完整。兼容关系在retired.relationships不可变保存，新旧幂等/AI版本隔离；reviewer→viewer不提权、scope_job_guard拦截在途旧提交。通用自定义Job/Outbox未整组取消。
- [容器验证](compose-smoke.json)：独立yoyo-s11-smoke/arm64镜像首次安装、停启、强制重建及一般任务/系统通知；scheduler/general/media健康，无reminder。实际使用实例未升级。
- [原应用回滚](rollback-verification.json)：只对隔离副本停写恢复原24迁移备份后，e4bd051原API读5篇旧Publication及修订关系；不能把新库直接降级给旧应用。源代码通过git archive e4bd051取得，未启动旧worker。
- [对象/凭据恢复](object-restore-verification.json)：四objects archive及五非空state archive在受限.local目录逐文件恢复核对SHA256；默认yoyo/dev共享bind state，另三smoke state和S2测试state。没有删除原对象或卷，也没有宣称孤儿清理。初次备份误指定未使用yoyo_state名字，创建了一个空卷/空tar；它未参与验收，保留空卷，不误称真实实例凭据。
- [沙箱](sandbox.json)：真实容器拒绝socket及/run/media-token读取，允许scratch工作文件，强制CPU/地址空间限制。5文件集成涵盖PNG/CSV/XLSX、两分片/续传/登录恢复、重复去重、大小/MIME/原件与分片哈希、公式/宏隔离、账号/purpose/组合角色、签名缺失/篡改/过期与撤销权限提交竞争。图片20MiB/表格50MiB；通过解析并不表示指标已确认。
- 构建/Prisma generate/前后端类型、77项集成和6项Chromium浏览器通过。浏览器1440/1280/390、键盘/Escape焦点、空/错/加载/会话过期、新笔记登记/更正与旧深链；[页面截图](screenshots/publications-390.png)为明确合成数据。
- 首轮AI共库被测试重置干扰，第二轮v1.2.0暴露工时臆算，第三轮v1.2.1仍列取消输入缺口；分别保留interrupted/pre-hours/pre-retired-gap报告，均不是通过证据。当前v1.2.2重跑20例，独立eval_final_test数据库；技术硬守卫与逐例质量收口后才关闭S3-07。

复现命令：python3 tools/s0/generate-contracts.py、tools/s0/validate-contracts.py（专用venv）、pnpm check:s11、docker compose config --quiet/build、node tools/s1/smoke-compose.mjs（新yoyo-s11-smoke项目/3100/59060）、pnpm exec tsx tools/s11/verify-migrations.ts、tools/s11/verify-rollback.ts、python3 tools/s11/verify-object-backups.py。迁移/恢复工具仅处理命名S11隔离副本；verify-rollback要求.local/s11-rollback-app已有基线git archive代码/node_modules链接。盘点工具只读取本机声明实例、保留停启状态，不覆盖已有备份。

所有备份原件/凭据及业务值只在权限受限忽略目录；提交仅脱敏计数/hash/合成样本/验证日志。S0-05真实后台/OCR未验，托管CI、Windows/x86实机、S7指标确认/复盘和S9全产品发布门禁未执行；不把本轮基础回归当完整发布或涨粉效果。
