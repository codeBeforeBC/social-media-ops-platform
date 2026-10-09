# S4中间开发证据

2026-10-09检查点，S4尚未完整验收。任务状态仅维护于[开发进度](../../tracking/开发进度.md)，交接见[开发日志](../../tracking/开发日志.md)LOG-033。

- API：`node tools/test-env.mjs pnpm exec tsx --test tests/production.test.ts`，最新18项通过，见[tdd-27绿灯](tdd-27-reference-labels-green.log)。
- 浏览器：构建后执行`node tools/test-env.mjs pnpm exec playwright test -c playwright.s4.config.ts`，最新3项通过，见[历史选择器绿灯](tdd-26-history-picker-green.log)。实际鼠标拖动手势、PNG实际解码、未保存保护和沙盒审核/登记均有断言。
- 构建与类型：[构建](checkpoint-build.log)、[类型](checkpoint-typecheck.log)。初步编辑契约验证129操作/21样例，尚未扩展全部审核/发布契约。
- TDD红灯/绿灯和失败修正日志均保留；浏览器拖动初次dragTo没有产生原生事件，使用完整鼠标移动手势后通过，不把失败记录当成功。

仅使用隔离测试数据库，图文测试素材为合成PNG；登记ID明确为沙盒。尚未进行S4-06真实来源＋实际最终设计PNG纵向演练，没有向平台发帖；回收事件仅持久Outbox，S6/S7消费者尚未接入。全量回归和ZIP解压逐文件核对仍待完成。
