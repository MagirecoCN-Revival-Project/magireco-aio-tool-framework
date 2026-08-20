# AIO 落地方案（第二版）

> 配套：[`AIO-ARCHITECTURE.md`](AIO-ARCHITECTURE.md)、
> [`PLUGIN-AUTHORING.md`](PLUGIN-AUTHORING.md)、[`CONSTRAINTS.md`](CONSTRAINTS.md)

每个阶段独立可用。上游 10 个仓库各自在演进，AIO 不能是「全做完才有用」的工程。

---

## Phase 0 — 框架内核 ✅ 已完成

| 交付 | 状态 |
|---|---|
| `@aio/core`：ref 语法（强制 universe 前缀）、能力/意图、事件总线 | ✅ |
| `@aio/registry`：交叉表，拒绝跨作品关联与编号猜测 | ✅ |
| `@aio/resource`：清单、多源回退、https 强制、sha256 校验 | ✅ |
| `@aio/kernel`：插件注册、意图派发、surface 生命周期、WebGL 上下文治理、iframe RPC 桥 | ✅ |
| `@aio/plugin-sdk`：`definePlugin` + 无头测试宿主 | ✅ |
| 契约与守卫改为插件模型，16 个坏样本自测 | ✅ |

**验收**（已通过）：`npm run check` —— 69 个单元与整合测试 + 16 个守卫坏样本，strict 模式 typecheck 全绿；
三个整合场景端到端跑通（剧情→ADV→进度回流、档案→iframe 精灵、插件互发意图）。

---

## Phase 1 — 第一个真插件 + 宿主外壳

选 `example-model-viewer` 打头阵：three.js 是 ESM，`inline` 隔离，是最简单的一个；
`example-sprite-mirror` 紧随其后，用来验证 iframe 桥在真浏览器里成立。

| 步骤 | 说明 |
|---|---|
| 1.1 | ✅ **已完成** `apps/station`：Next.js + React 19 宿主外壳，`output: 'export'` 静态导出到 EdgeOne Pages 单项目。含 React↔内核的 surface 桥、能力驱动的 UI、插件装卸后台。占位插件待换真查看器，见 [`apps/station/README.md`](../apps/station/README.md) |
| 1.2 | ✅ **已完成** `packages/plugin-model-3d`：把 example-model-viewer 包成插件，模型走资源面。上游一行未改（它的构造函数本来就是 `Record<路径, URL>` 注入式），10 个测试全在 node 上跑——上游两个类是注入的，不需要 three.js 与 GPU。**尚未接进 `apps/station`**：要等 `upstream-three-subpackage` 可安装（发包或 git 依赖） |
| 1.3 | `plugins/sprite-viewer`：cocos2d 子帧 + `MessagePort` 传输实现 |
| 1.4 | 交叉表首批数据：先做 810 个精灵 unit ↔ charaId 的人工核对 |
| 1.5 | 一个能演示的页面：角色档案 → 点一下出精灵、点一下出 3D |

**验收**：
- 同一个页面上先后打开 3D 与精灵，两个运行时互不干扰；
- 开够 5 个 WebGL surface，最早的被 `suspend` 而不是变黑；
- 断掉主 base，资源自动回退到备用 base；
- 拔掉 `sprite-viewer` 插件，档案页的「显示精灵」按钮消失，其余功能不受影响。

最后一条是**框架是否成立的判据**。

**工作量**：6–9 人日。

---

## Phase 2 — 资源面搬迁

把 20 GiB 资源迁到 COS + EdgeOne CDN，生成清单。这是最大的一块，
也是所有后续阶段的公共前提。

| 步骤 | 说明 |
|---|---|
| 2.1 | COS 桶 + EdgeOne 回源，绑 `assets.<域>` |
| 2.2 | `tools/build-manifest.py`：扫目录出 `{path, role, bytes, sha256}` |
| 2.3 | `sprite/` 4,025 组 → 2.4 `sp/` 48,964 张 → 2.5 `live2d/` → 2.6 `3d/` |
| 2.7 | 下架能力：清单去条目 → UI 降级提示，不白屏 |

**风险**：48,964 张图不是「传 5.8 G」，是**发 48,964 次请求**。用批量工具 + 并发，
预留一整天。

**验收**：四个插件的部署产物都掉到几 MB 量级；任取 20 个文件核对 sha256；
从清单删一条，前端显示「已下架」。

**工作量**：8–12 人日。

---

## Phase 3 — 剩下三个插件 + Story 宿主

| 步骤 | 说明 |
|---|---|
| 3.1 | `plugins/adv-player`：命名空间 b ADV 包成 iframe 插件，实现 `progress` 上报 |
| 3.2 | `plugins/viewer-sp` |
| 3.3 | `plugins/call-search` |
| 3.4 | **example-reader 装插件**：它作为独立宿主 `kernel.register(advPlayer)`，剧情页多出「实机播放」 |
| 3.5 | `/story/` 反代进统一域名 |

3.4 是本方案最有说服力的一步：**example-reader 不被吸收，主权不变，只是多了能力。**
这同时绕开了它「未授予任何开源许可」的约束——我们不 vendor 它的代码。

**验收**：在 example-reader 上读剧情，点「实机播放」，ADV 起播并把行号回传高亮。
这正是你举的第一个例子。

**工作量**：10–14 人日。

---

## Phase 4 — 交叉表补全

Phase 1 只做了首批。这一步把 241 个角色、1,404 条卡牌、10,511 条语音字幕、
725 篇剧情的关联关系补齐并人工核对。

**这是整个项目里价值最高、也最没法自动化的一块**——编号规律不成立
（见架构文档 §二 的证据），只能靠数据。

工具做「候选生成 + 差异报告」，人做判定：
`tools/propose-links.py` 出候选，`registry/data/*.json` 存人工确认的结果，
守卫检查跨作品关联与孤儿条目。

**工作量**：工具 3–5 人日；人工核对按角色数摊，可增量做。

---

## Phase 5 — Client 工位 + 鉴权后台

| 步骤 | 说明 |
|---|---|
| 5.1 | 边缘函数探测线上 `config.json` 的 `mirrors[]`，结果写 KV |
| 5.2 | 线路看板、`branch_versions` 停止支持开关看板、APK 下载 |
| 5.3 | 鉴权后台（`noindex`）：`/codex/` 资料、`/lab/` API 规格 |

5.3 的前提是**待拍板事项 1**。默认按「不公开」实现。

**工作量**：5–8 人日。

---

## Phase 6 — AI 能力

优先级：**客户端诊断 Agent > 剧情语义检索 > 资料问答**。

诊断 Agent 排第一是因为知识库现成（客户端 README 的启动链表 + 34 个 native hook +
调试开关三分类），解决的是维护者每天真在处理的事。

**不得成为前面任何阶段的依赖。**

---

## 总览

| 阶段 | 工作量 | 停在这里能交付吗 |
|---|---|---|
| 0 框架内核 | ✅ 已完成 | ✅ 五个包可独立发布使用 |
| 1 首个插件 + 外壳 | 6–9 人日 | ✅ 可演示的整合站 |
| 2 资源面搬迁 | 8–12 人日 | ✅ 四个查看器全上线 |
| 3 剩余插件 + Story | 10–14 人日 | ✅ 你举的两个例子都成立 |
| 4 交叉表补全 | 3–5 人日 + 增量人工 | ✅ 可增量 |
| 5 Client + 后台 | 5–8 人日 | ✅ |
| 6 AI | 待估 | ✅ |

**关键路径是 Phase 2。** 它不做完，其余全部卡在资源上。
只有时间做一件事的话，做 2.1 + 2.2（桶 + 清单工具）。

## 先决条件

- [ ] 一个可用域名（国内加速需 ICP 备案；Cloudflare 托管的根域名不支持绑定，用子域）
- [ ] EdgeOne 账号与 Pages/Makers 开通
- [ ] COS 桶与 EdgeOne 回源配置权限
- [ ] 架构文档「待验证项」4 条的复核结论
- [ ] 架构文档「待拍板事项」3 条的决定
