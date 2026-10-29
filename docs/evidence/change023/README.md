# CHANGE-023 空运营账号删除

本页记录2026-10-28首次实现；2026-10-29已按用户要求移除名称输入，现行交互与检查见[CHANGE-024](../change024/README.md)。

2026-10-28（Asia/Shanghai）；Codex；工作目录 `/Users/junlong/projects/social-mdeida-ops-platform`，分支 `codex/s9-acceptance`，基线 `ad4edd7` 加本轮未提交修改。状态仅维护于[开发进度](../../tracking/开发进度.md)。

## 行为与边界

运营账号列表和详情底部提供删除入口。确认区显示目标名称和内部ID，需输入完整本地备注名称；支持取消，删除期间禁用关闭/确认/取消，失败保留输入，版本冲突须读取最新账号并重新确认。成功关闭详情、提示并刷新列表，工作台和数据复盘重新读取的账号选择器不再包含已删除账号。

仅删除没有任何受保护关联的本地登记；有笔记、选题、指标、导入/文件、验证、任务/事件或保留的历史表外键关联时明确拒绝。取消或失败的验证/任务记录仍是历史。此次不包含归档或连带删除历史数据，也不操作真实平台账号。

[删除命令](../../../apps/api/src/commands.ts)使用父账号FOR UPDATE锁，检查所有引用accounts的外键，包括保留历史表和未来新增的引用表。只移除账号权限关联和空账号，保留追加式审计及幂等记录。相同删除键重放原200结果；已删除账号的旧创建/编辑键无法复活记录，重新登记同一平台身份使用新UUID。

DELETE /accounts/{id}要求管理员、Origin/CSRF、幂等键、expected_version、confirmed=true和confirmation_name。成功返回JSON `{account_id,deleted:true}`；不存在/跨空间404，版本或关联冲突409，确认不完整422。无效旧平台ID不阻止删除真正的空登记。

## 验证

- [构建](build.log)、[类型检查](typecheck.log)、[生成清单](contract-manifest.json)及[25契约样例](contract-validation.json)通过；71路径/86操作/127Schema，未增加迁移。
- [175项完整集成与边界检查](integration.log)通过，其中[8项删除专项](deletion-tests-first.log)覆盖确认/版本/权限、成员清理、审计、幂等重放、旧请求不复活、已有笔记/验证/任务保护、跨空间、无效旧ID、新外键及ON DELETE CASCADE保护。
- 两个数据库并发场景实际观察锁等待：关联写入先取得外键锁时，删除等待并在写入提交后拒绝；删除先取得父锁时，新关联插入等待后23503失败，无孤立或被连带删除的数据。
- [浏览器专项3项](browser-focused.log)通过；[全量检查](browser.log)29通过/1旧定位歧义，新增按钮可访问名称包含账号名，原测试使用模糊cell匹配导致两个结果；改为准确名称后[最后4项复验](browser-final.log)全部通过，覆盖现30场景。最后复验等待真实看板/账号列表响应及选项数，确认删除后选择器无旧账号，未以加载前空态代替证据。
- 首次[专项浏览器2通过/1定位超时](browser-first.log)为测试把包含必填标识的label当精确文本，改用输入框可访问语义；[首次构建](build-first.log)发现新测试数组访问需显式非空断言，补齐后构建/类型通过。失败日志保留，不当成功证据。

[桌面删除确认](screenshots/account-delete-1440.png)、[320px确认](screenshots/account-delete-320.png)为明确合成账号。旧功能全量回归生成的其他截图保留在私有测试产物目录，本目录只保存此次相关图片。

## 本地交付

[完整Docker构建](docker-build.log)、[本地API更新](local-upgrade.log)及[运行核对](local-runtime.json)通过。只no-deps更新API，无数据库迁移；59张业务表完整count/hash、默认身份、AI私有配置保持，40条已应用迁移不变，提供的JS/CSS及后端命令与已测编译一致。

API旧镜像已保存为 `yoyo-local:change023-api-rollback` 并核对原编译文件hash；原受限备份继续保留，本次纯API更新未新建数据备份。worker/media/scheduler、宿主桥接和原dev依赖未调整；临时S8测试存储/解析器最终停止、卷保留。

[当前真实页面只读核查](local-browser.json)验证列表入口、明确确认、缺名称时禁用、取消保持，以及1440/320px无页面横向溢出；0写请求/0脚本错误。[实际桌面](screenshots/local-delete-1440.png)、[实际320px](screenshots/local-delete-320.png)遮挡账号名称/标识。**本轮没有删除任何当前用户账号**，也没有真实模型、来源采集或平台写操作。

本功能不替代IN-10身份核对，不关闭原S9/S10/跨日RPO或暂缓数据等发布门禁。最终使用方式：运营账号列表“删除”或详情底部“删除账号”→核对目标→输入本地备注名称→确认；若有关联，按服务器返回类别保留记录。
