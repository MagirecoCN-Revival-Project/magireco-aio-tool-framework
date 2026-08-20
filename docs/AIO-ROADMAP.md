# AIO 工作站落地方案

> 配套文档：[`AIO-ARCHITECTURE.md`](AIO-ARCHITECTURE.md)（架构）、
> [`CONSTRAINTS.md`](CONSTRAINTS.md)（硬约束登记）

六个阶段。**每个阶段独立可用**——任何一个阶段停在那里，交付出去的东西
都是完整的，不会留下半截。这是刻意的：上游 10 个仓库都在各自演进，
AIO 不能是一个"全做完才有用"的工程。

---

## Phase 0 — 控制面骨架

**目标**：契约、策略、守卫先立起来，后面每接一个源都走同一条路。

| 交付 | 状态 |
|---|---|
| `repository-policy.json`：10 个仓库的公开面许可登记 | 本次交付 |
| `contracts/aio-source.schema.json`：接线契约 Schema | 本次交付 |
| `contracts/*.source.json`：逐仓库契约 | 本次交付（骨架，预算待实测） |
| `tools/check-sources.py`：四项守卫 | 本次交付 |
| CI：push 即跑守卫 | 本次交付 |

**验收**：`python3 tools/check-sources.py` 绿灯；故意把 `wiki-data` 的
`publish` 改成 `allowed` 或给它加 `mount`，脚本必须红灯。

**工作量**：已完成。

---

## Phase 1 — 壳 + 两个纯静态查看器

**目标**：一个能点开的门户，两个能用的查看器。证明"多 Pages 项目 + 路由缝合"
这条路走得通。

选 `example-model-viewer`（734 M / 1,780 文件）和 `example-sprite-mirror`（3.1 G / 8,164 文件）
打头阵，因为它们**不需要服务端**，且各自都在单项目限额之内（sprite 需先做一轮
体积核算，见下）。

| 步骤 | 说明 |
|---|---|
| 1.1 | 建 EdgeOne Pages 项目 `aio-shell`，绑子域，跑通 CI 部署 |
| 1.2 | 写门户页：六个工位入口 + 顶栏注入片段（一个 JS + 一个 CSS） |
| 1.3 | 建 `aio-viewer-3d`，源 `example-model-viewer`，构建 `npm ci && npm run build`，产物 `dist` |
| 1.4 | 建 `aio-viewer-sprite`，源 `example-sprite-mirror`（纯静态，无构建） |
| 1.5 | 从契约生成 EdgeOne 路由规则，`/viewer/3d/`、`/viewer/sprite/` 挂上 |
| 1.6 | 两个查看器各引一行顶栏注入片段 |

**验收**：
- 同一个域名下，`/`、`/viewer/3d/`、`/viewer/sprite/` 三个页面都能打开；
- 三个页面顶栏一致、深色模式一致；
- 切换查看器是整页加载，且**不出现** three.js 与 cocos2d 同时在场；
- `check-sources.py` 里两个项目的实测文件数/体积已回填，且在限额内。

**风险**：`example-sprite-mirror` 3.1 G 逼近 5 GiB 上限，且里面 4,025 组精灵理应属于
资产面。若实测超限，把它降级到 Phase 2 之后，Phase 1 只上 3D。
**这不算延期，算按判据行事。**

**工作量**：3–5 人日（含首次摸平台的时间）。

---

## Phase 2 — 资产外置（最大的一块）

**目标**：把 5.8 G 的图、4,025 组精灵、Live2D 与 HCA 全部迁到 COS + EdgeOne CDN，
Pages 项目只剩壳。这一步做完，剩下四个阶段才有空间。

| 步骤 | 说明 |
|---|---|
| 2.1 | 建 COS 桶 `aio-assets`，EdgeOne 回源加速，绑 `assets.<域>` |
| 2.2 | 写 `tools/build-manifest.py`：扫目录出 `{path, size, sha256}` + 多 base |
| 2.3 | `example-live2d-viewer` 的 `image/`（48,964 张）迁 `sp/` |
| 2.4 | `example-sprite-mirror` 的 4,025 组迁 `sprite/` |
| 2.5 | `example-adv-live2d` 的 Live2D/HCA/WebM 迁 `live2d/` |
| 2.6 | `example-model-viewer` 的 `.fbx.gz` 迁 `3d/`，沿用 `Content-Encoding: gzip` header |
| 2.7 | 四个前端改成"查 manifest 取件"，加多 base 回退 |
| 2.8 | 下架能力：manifest 去条目 → 前端降级提示，不白屏 |

**验收**：
- 四个 Pages 项目的文件数与体积都掉到限额的一半以下；
- 断掉主 base，前端自动回退到备用 base 并正常渲染；
- 从 manifest 里删一个条目，前端显示"已下架"而不是碎图或白屏；
- 任取 20 个文件核对 sha256 与 manifest 一致。

**风险**：
- **小文件海量上传**是这一步的真实成本——48,964 张图不是"传 5.8 G"，
  是"发 48,964 次请求"。要用批量工具 + 并发，并预留一整天。
- 前端改造要逐个查看器回归，`example-adv-live2d` 那 91 个 vitest
  测试是资产，别绕过它们。

**工作量**：8–12 人日。这是整个方案里唯一的大块头。

---

## Phase 3 — Story 工位接入（反代先行）

**目标**：`/story/` 在 AIO 域名下可用，**不动** example-reader 现有的
Cloudflare 部署与校对系统。

| 步骤 | 说明 |
|---|---|
| 3.1 | EdgeOne 规则：`/story/*` 反代到现有 Worker |
| 3.2 | 理顺 Cookie 域与 Turnstile 的站点域名配置 |
| 3.3 | 顶栏注入片段接进 example-reader 的 layout |
| 3.4 | 全链路回归：读剧情 → 投稿 → 审核 → 建 PR |

**验收**：投稿链路的 7 个基准哈希校验全部照旧通过；
`Validate Community Proofreading PR` 流水线绿灯。

**明确不做**：不在本阶段迁移 OpenNext。理由写在架构文档 §六——
这是一个正在服务真人的系统，"全在 EdgeOne 上"不值得拿它冒险。

**工作量**：2–4 人日。

### Phase 3.5 —（可选）迁移评估

只有 Phase 3 稳定运行一段时间、且待验证项 2/3（EdgeOne 对 Next.js 16 SSR 的
支持程度、KV 语义）确认可行后才启动。产出是一份**可行性报告 + 回滚方案**，
不是直接迁。

---

## Phase 4 — 检索合并

**目标**：`/search/` 一个入口，同时搜"角色称呼"与"剧情全文"。

| 步骤 | 说明 |
|---|---|
| 4.1 | `example-search-site` 清 `node_modules`、清 9 个 trigger 文件，`public/` 上 `aio-search` |
| 4.2 | 接 example-reader 已有的 split search index（`artifacts/search-split`） |
| 4.3 | 统一搜索框：一次输入，分栏出两类结果 |
| 4.4 | 身高图表与关系图的图片导出沿用现有实现 |

**验收**：搜一个角色名，同时返回称呼条目与剧情命中；两边都能跳到对应工位。

**工作量**：4–6 人日。

---

## Phase 5 — Client 工位 + 鉴权后台

**Client 工位**（公开）：

| 步骤 | 说明 |
|---|---|
| 5.1 | 边缘函数定时探测线上 `config.json` 的 `mirrors[]`，可用性写 KV |
| 5.2 | 线路看板：名称、权重、探测结果 |
| 5.3 | `branch_versions` 停止支持开关看板（对着 CONTRIBUTING §八 的字段） |
| 5.4 | APK 下载页，第一条线路为推荐 |

**鉴权后台**（`noindex`，仅维护者）：

| 步骤 | 说明 |
|---|---|
| 5.5 | 接入鉴权（EdgeOne Functions + KV 会话） |
| 5.6 | `/codex/` 资料工位 —— **前提是维护者解除 wiki-data 的公开禁令，或明确其"仅鉴权后台"可用** |
| 5.7 | `/lab/` API 规格浏览器（example-user-archive 的 205 个端点 / 1,383 个样本） |

**验收**：未登录访问 `/codex/`、`/lab/` 一律 401；
`robots.txt` 与响应头都带 `noindex`；守卫脚本确认这两条路径不在公开 sitemap 里。

**工作量**：5–8 人日。

---

## Phase 6 — AI 能力

按架构文档 §九 的三条，优先级：**客户端诊断 Agent > 剧情语义检索 > 资料问答**。

诊断 Agent 排第一是因为知识库现成（README 的启动链表 + 34 个 native hook +
调试开关三分类），而且它解决的是维护者每天真在处理的事。

**工作量**：视 Makers 的 Agent 托管能力而定，先做一个原型再估。

---

## 总览

| 阶段 | 工作量 | 阻塞依赖 | 停在这里能交付吗 |
|---|---|---|---|
| 0 控制面 | 已完成 | — | ✅ 守卫可独立使用 |
| 1 壳 + 2 查看器 | 3–5 人日 | 域名/备案 | ✅ 一个能用的门户 |
| 2 资产外置 | 8–12 人日 | COS 开通 | ✅ 四个查看器全上线 |
| 3 Story 反代 | 2–4 人日 | Phase 1 | ✅ 六个工位齐五个 |
| 4 检索合并 | 4–6 人日 | Phase 2 | ✅ |
| 5 Client + 后台 | 5–8 人日 | 待拍板事项 1 | ✅ |
| 6 AI | 待估 | Phase 4 | ✅ |

**关键路径是 Phase 2。** 它不做完，其余全部卡在限额上。
如果只有时间做一件事，做 Phase 2 的 2.1 + 2.2（桶 + manifest 工具）——
那两步是所有后续步骤的公共前提。

## 先决条件清单

开工前需要拿到的东西，缺一项就有阶段跑不动：

- [ ] 一个可用域名（国内加速需 ICP 备案；注意 Cloudflare 托管的根域名暂不支持绑定，用子域）
- [ ] EdgeOne 账号与 Pages/Makers 开通
- [ ] COS 桶与 EdgeOne 回源配置权限
- [ ] 架构文档「待验证项」5 条的复核结论
- [ ] 架构文档「待拍板事项」3 条的决定
