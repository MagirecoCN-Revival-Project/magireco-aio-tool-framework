# 硬约束登记

> 这份表是 `repository-policy.json` 与 `tools/check-sources.py` 的人类可读版本。
> **两边不一致时以 `repository-policy.json` 为准**——那份是机器读的，守卫脚本
> 认它。改了这份记得同步那份，反之亦然。

---

## 一、公开面许可

| 仓库 | 公开面 | 依据 |
|---|---|---|
| `example-client` | ✅ 允许（产物链接） | 公开仓库，已在对外分发 APK |
| `example-model-viewer` | ✅ 允许 | 已有公开 Demo |
| `example-adv-live2d` | ✅ 允许 | 已有 Pages 部署 |
| `example-live2d-viewer` | ✅ 允许 | 已有公开预览 |
| `example-sprite-mirror` | ✅ 允许 | 公开镜像 |
| `example-search-site` | ✅ 允许 | 已在 Cloudflare Pages 对外 |
| `example-reader` | ✅ 允许（**仅挂载/反代，不得 vendor**） | 仓库自述为公开归档用途 |
| `example-restricted-data` | ❌ **禁止** | 仓库自带 `repository-policy.json` + CI 校验；2026-08-15 公开站已退役 |
| `example-user-archive` | ❌ **禁止** | 私有仓库；190 名真实玩家 55 天流量归档 |
| `magireco-aio-tool-framework` | ✅ 允许 | 本仓库 |

**两条禁令不是本方案的判断，是既有约束。** 解除需维护者明确决定，
并同步修改上游仓库自己的策略文件——只改 AIO 这边不算数。

---

## 二、许可证与义务

| 仓库 | 许可 | AIO 需要承担的义务 |
|---|---|---|
| `example-client` | GPLv3 + `LICENSE.additional-terms` | 转载产物时附许可与第三方声明链接；**不得**把 `patch/`、`tools/` 抄进 AIO 树 |
| └ 其内 aria2（双后端） | GPLv2+，gnutls 组静态链 LGPL | 提供对应源码；LGPL 部分需可重链 |
| └ 其内 libarchive | BSD-2-Clause + zlib | 附版权声明与许可全文 |
| └ 其内 ShadowHook | MIT（且已改过源码） | 附声明并注明改动 |
| └ 其内 命名空间 a CN 字体 | Apache-2.0 | 附许可、注明改动 |
| `example-reader` | **未授予任何开源许可** | 🔴 **绝不 vendor、绝不再分发其内容**；只能同域挂载或反代 |
| `example-search-site` | fork 自 third-party-author 的开源项目 | 保留原作者署名与原始项目链接 |
| `example-model-viewer` / `ExampleAdv…` | 代码可用；模型素材归版权方 | 素材进资产面，支持随时下架 |
| `example-sprite-mirror` / `example-live2d-viewer` | 游戏原始素材 | 同上 |
| `example-restricted-data` | 见其 `NOTICE.md` / `TAKEDOWN.md` | 不进公开面，义务不适用 |
| 本仓库 | GPLv3 | — |

**通用**：所有游戏内容（角色、立绘、语音、音乐、剧情文本）版权归
各自的版权方所有。AIO 与版权方无任何关联，未获授权或认可。
版权方主张时按 `example-restricted-data/TAKEDOWN.md` 的流程下架。

### 🔴 由此推出的铁律 9：资源与代码必须分离

上面这条「版权归版权方」与「本仓库 GPLv3」放在一起，直接推出一条硬约束：

> **版权文件一个都不能进这个仓库。**

GPLv3 要求分发者对**整份分发物**授予再分发与修改的权利。我们对游戏素材没有
这个权利，所以素材一旦入库，整份 GPLv3 分发就变成一个我们无权做出的授权声明。

三条使它不可挽回：

| | 后果 |
|---|---|
| **历史不可逆** | 删文件只让当前 HEAD 干净；历史里那份仍在随每次 clone 分发。真抹掉要改写历史并强推，而下游克隆不会自动跟着改 |
| **下架管不到克隆** | 版权方主张时我们能下架的只有资源面。已经分发出去的 git 历史，下不了 |
| **传染整份分发** | 不是「这个文件有问题」，是「这份 GPLv3 分发的授权声明有问题」 |

所以判据是**一个都不能进**，不是「少放一点」，也不是「先放着回头清」。

**执行**（不靠自觉）：

| 层 | 手段 |
|---|---|
| 本地 | `npm run check` 末尾跑 `tools/check-assets.py` |
| 推送 | `pre-push` 钩子查本次推送**新增提交**引入的文件（逃生口 `SKIP_ASSET_HOOK=1`） |
| CI | `checks.yml` 的 `assets` job：先跑坏样本自测，再扫当前树 |

判定三条：**扩展名**（图片/音频/视频/3D/Live2D/Cocos/字体）、**体积**
（超 256 KiB——素材换个扩展名还是素材）、**目录名**（`assets/` `image/`
`voice/` 等不得出现在代码树里）。误伤在 `tools/check-assets.py` 的 `ALLOW`
里按路径登记并写明理由；**加一条等同于改铁律，请当成改铁律来审**。

素材的正确去处是资源面（COS + EdgeOne CDN），经 `@aio/resource` 的清单
按 ref 取用——见 `docs/AIO-ARCHITECTURE.md` §五。这也是铁律 3
（插件只能经 `host.resources` 拿资源）的上游理由：**插件不碰 URL，
是因为 URL 后面的东西不属于我们。**

---

## 三、平台限额

### EdgeOne Pages（单项目）

| 项 | 限额 | 来源 |
|---|---|---|
| 单文件大小 | 25 MiB | 第三方技术文章，**待官方复核** |
| 文件数量 | 20,000 | 同上 |
| 存储容量 | 5 GiB | 同上 |

⚠️ **开工前必须在 EdgeOne 控制台与官方文档复核。**

第一版方案曾据此把交付面拆成 7 个 Pages 项目。第二版把资源**全部**外置到
COS + EdgeOne CDN 之后，部署产物只剩代码与插件 chunk，**一个 Pages 项目就够了**，
对这三个数字的敏感度大幅下降。但 `tools/check-sources.py` 的第 5 条仍盯着它：
契约里声明的资产量若逼近限额，说明它没有真的外置。

### 域名

- 国内加速区域需完成 **ICP 备案**；海外加速区域无需备案。
- **Cloudflare 托管的根域名暂不支持绑定**，用子域。

### 未确认

- Pages Functions 的 CPU 时间 / 内存 / 请求体上限
- EdgeOne KV 的配额与一致性语义
- 对 Next.js 16 + React 19 SSR 的支持程度

---

## 四、实测占用（2026-08-20）

| 仓库 | 入库文件数 | 磁盘占用 |
|---|---:|---:|
| `example-adv-live2d` | 13,883 | 7.0 G |
| `example-live2d-viewer` | 49,358 | 5.8 G |
| `example-sprite-mirror` | 8,164 | 3.1 G |
| `example-reader` | 47,886 | 2.2 G |
| `example-model-viewer` | 1,780 | 734 M |
| `example-user-archive` | 1,385 | 123 M |
| `example-search-site` | 4,517 | 92 M |
| `example-restricted-data` | 83 | 86 M |
| `example-client` | 216 | 77 M |
| `magireco-aio-tool-framework` | 1 | 288 K |

对照上面的 Pages 限额：**没有任何一个重仓库能整体塞进一个 Pages 项目**——
所以资源外置不是优化，是前提。外置之后这张表里的数字全部落到资源面（COS），
交付面只剩几 MB 的代码。

---

## 五、上游既有约定（AIO 沿用）

来自 `example-client` 的 `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md`，
本仓库沿用以下几条：

- commit 信息用 **Conventional Commits 前缀 + 中文描述**；一功能一 commit。
- 执笔的 Agent 用 `Co-authored-by` trailer 署名（完整 `Name <email>`）。
- **不写模型标识**到任何入库产物。
- **禁止一次性 workflow**，禁止用文件触发 CI。
- 改了行为/协议/构建/安全机制的提交，结尾交代对应文档改动。

---

## 六、框架自身的约定

- **插件源码里 grep 不到任何 host 名或资源路径。** 资源一律走
  `host.resources`，否则换 CDN 与下架能力全部失效。
- **`isolation: 'iframe'` 必须写 `isolation_reason`**（守卫会拦）。隔离有代价，
  不写清为什么，下一个人无从判断能不能改回 inline。
- **占 WebGL 必须声明 `usesWebGL`。** 不声明的后果不是报错，是浏览器静默丢弃
  最早的上下文——某个已打开的查看器突然变黑，控制台什么都没有。
- **交叉表查不到就返回空，绝不按编号规律猜。** 猜错的代价是显示了另一个角色。
