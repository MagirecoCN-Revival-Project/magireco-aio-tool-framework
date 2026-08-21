# ACTIVE.md — 在制工作登记

> 开工时加一行，完工删行。10 秒成本，消灭最严重的对撞。
> 格式：`日期 | 人/Agent | 在搞什么 | 预计动哪片`
> 规则见 [CONTRIBUTING.md](CONTRIBUTING.md) §六。

| 日期 | 谁 | 在搞什么 | 预计动哪片 |
|---|---|---|---|
| （示例，可删）2026-08-20 | Claude | 框架内核与规范落地 | packages/ tools/ 文档 |

## 阻塞项（等外部条件，不是在制）

> 记在这里是因为它们会被反复重新发现。解开条件写清楚，谁看到谁能接手。

| 日期 | 卡在哪 | 解开的条件 |
|---|---|---|
| 2026-08-20 | `@aio/plugin-model-3d` 写完并测过（10 个测试），但**接不进 `apps/station`** | 上游子包 `upstream-three-subpackage` 目前只存在于 `example-model-viewer` 仓库的工作区里，不可安装。需要二选一：① 在该仓库发一个 npm 包；② station 用 git 依赖指向该仓库子目录。**把本地路径写进依赖会让别人的克隆直接坏掉。**<br>2026-08-21 降级：`model3d.show` 现在有一个从零写的实现（`@aio/plugin-gltf`）装在 station 里，所以这条不再挡任何东西——它只挡「用上游那个查看器」这一个选项。全貌见 `contracts/capabilities.json`。 |
