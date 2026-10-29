# BUG-041 运行状态与审计切页白屏

2026-10-29；Codex；实际目录 `/Users/junlong/projects/social-mdeida-ops-platform`，分支 `codex/s9-acceptance`，基线 `ad4edd7` 加既有未提交修改。任务状态只见[开发进度](../../tracking/开发进度.md)。

用户点击运行状态或审计记录后整个页面白屏。[实际修复前只读复现](before.json)在两个方向均出现：monitor→audit报`Cannot read properties of undefined (reading 'length')`，反向报`reading 'ai'`；main和body正文都消失，初始接口200，切换后的新接口还未请求。没有业务写请求。

根因：Settings在相同React组件位置切换两个DataList，只更改path/title；useData保留上一页已加载的数据与loading=false，useEffect尚未刷新就按新页面的结构读取旧结果，未捕获渲染异常导致根页面卸载。另一个先失败用例确认：监控初次请求503后data=null，错误提示和Monitor仍同时渲染，也会白屏。迟到的旧请求可进一步覆盖新页面数据。

修复仅涉及[页面入口](../../../apps/web/src/main.tsx)的两处：DataList以页签为key，切页时隔离查询生命周期；请求失败时仅展示可重试错误，不渲染Monitor空数据。[浏览器回归](../../../tests/browser.spec.ts)追加4项：双向直接往返、503及重试、空审计、旧请求晚返回。没有全局查询重构、新依赖或后台/数据库变更。

| 检查 | 结果 |
|---|---|
| 新回归修复前 | [4项失败](browser-before.log)，与白屏症状一致；日志保留 |
| 新回归修复后 | [4项通过](browser-targeted.log) |
| 全页面回归 | [37项通过](browser-tests.log)，含现有选题、导入、报告、账号验证/删除及运行入口 |
| 构建/类型 | [原生构建](build.log)、[类型](typecheck.log)、[Docker源码构建](docker-build.log)通过 |
| 实际部署复验 | [同一只读复现脚本](after.json)两方向无pageerror、main保留、新接口按页签读取，0写请求；[运行资源](local-runtime.json)与已测JS/CSS及后端编译一致 |
| 数据保持 | 62张业务表count/hash、默认身份及AI私有配置保持；41迁移不变，无新增迁移 |

此前运行入口测试使用monitor→jobs→audit，经过后台任务页会卸载DataList，未覆盖直接互切；本轮补上该路径以及旧响应/失败边界，不把此前33项通过解释成覆盖本缺陷。

本地只no-deps更新API容器以发布静态前端，网页3000/存储59001保持；worker/media/scheduler、宿主桥接59025及dev依赖未更新。回滚镜像`yoyo-local:bug041-api-rollback`已标记并核对，沿用已有受限备份；本轮未做新的数据备份或迁移。S8测试服务最终停止，卷保留；未删除用户账号、未调用真实模型/来源采集/平台写入。未重复不受本次前端改动影响的全后端/契约套件。

复发预防：不同结构的接口不能共享未分作用域的组件查询状态；回归应直接双向切换，并覆盖错误与迟到请求。无需引入额外状态库来解决本缺陷。源码/证据/交接未提交或推送。
