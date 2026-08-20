# AIO 工作站架构

> 版本：2026-08-20 初稿
> 交付平台：EdgeOne Maker / Pages（主）+ COS + EdgeOne CDN（资产）
> 控制面：本仓库 `magireco-aio-tool-framework`

---

## 一、要解决的问题

现状是 10 个仓库、5 条技术栈、4 个各自独立的查看器、3 套互不相通的检索，
以及一个已经在分发的客户端。用户要用全套，得记住 6 个以上的地址；维护者要改
一处共性问题（比如字体、深色模式、资源线路），得改 4 遍。

**但"统合"不等于"合并"。** 见下节的三条硬约束——它们决定了这只能是一个
**聚合层**，不能是一个 monorepo。

---

## 二、三条不可协商的约束

### 1. 两个仓库禁止出现在公开面

| 仓库 | 禁令来源 | 性质 |
|---|---|---|
| `example-restricted-data` | 仓库自带 `repository-policy.json` + CI 校验，2026-08-15 起公开站已退役 | **既有硬约束**，不是本方案的判断 |
| `example-user-archive` | 私有仓库，190 名真实玩家的 55 天流量归档 | 即便已脱敏也不外发 |

这两个仓库的能力（角色/卡牌/道具/语音资料、API 规格）只能进
**鉴权后台**，且默认 `noindex`。**本方案无权解除这两条禁令**——要改得由维护者
另行决定，见「待拍板事项」。

### 2. 许可证互斥，不能 vendor

| 仓库 | 许可状态 | 对 AIO 的后果 |
|---|---|---|
| `example-client` | GPLv3 + `LICENSE.additional-terms` + 第三方声明义务（aria2 GPLv2+ 源码提供、GnuTLS LGPL 可重链、libarchive BSD、ShadowHook MIT、字体 Apache-2.0） | 只链接产物，不进 AIO 树 |
| `example-reader` | **明确不授予任何开源许可** | **绝不 vendor**，只能挂载/反代 |
| `example-sprite-mirror`、`example-live2d-viewer` | 游戏原始素材，归版权方 | 只做壳，素材进资产面并可随时下架 |
| `example-model-viewer`、`example-adv-live2d` | 代码可用，模型素材归版权方 | 同上 |
| `example-search-site` | fork 自 third-party-author 的开源项目 | 需保留原作者署名 |

把这些 vendor 进一棵 GPLv3 的树，第一天就自相矛盾。

### 3. EdgeOne Pages 单项目限额

> 数据来源：第三方技术文章（官方文档站取用时 503）。**开工前必须在控制台
> 与官方文档复核**，见「待验证项」。

| 项 | 限额 |
|---|---|
| 单文件大小 | 25 MiB |
| 文件数量 | 20,000 / 项目 |
| 存储容量 | 5 GiB / 项目 |

对照实测占用：

| 仓库 | 文件数 | 体积 | 单项目能否装下 |
|---|---:|---:|---|
| `example-live2d-viewer` | 49,358（其中 `image/` 48,964） | 5.8 G | ❌ 文件数 2.5x 超限，体积超限 |
| `example-reader` | 47,886 | 2.2 G | ❌ 文件数 2.4x 超限 |
| `example-sprite-mirror` | 8,164 | 3.1 G | ⚠️ 文件数够，体积逼近上限 |
| `example-model-viewer` | 1,780 | 734 M | ✅ |
| `example-adv-live2d` | 13,883 | 7.0 G | ❌ 体积超限 |
| `example-search-site` | 4,517（含 3,988 个入库的 `node_modules`） | 92 M | ✅（清掉 node_modules 后） |

**结论：一个 Pages 项目装不下任何一个重仓库，更装不下全部。**
架构必须是"多项目 + 壳资分离"，这不是设计偏好，是限额算出来的。

---

## 三、三个平面

```
┌─────────────────────────────────────────────────────────────┐
│ 控制面  magireco-aio-tool-framework（本仓库）                │
│   契约表 contracts/*.source.json                             │
│   策略   repository-policy.json                              │
│   守卫   tools/check-sources.py                              │
│   不存业务数据，不存资源，只存"指针 + 判据"                   │
└───────────────┬─────────────────────────────────────────────┘
                │ 生成路由规则 / 构建编排 / 预算检查
                ▼
┌─────────────────────────────────────────────────────────────┐
│ 交付面  EdgeOne Pages 项目群（复数！）                        │
│   aio-shell / aio-viewer-3d / aio-viewer-live2d /            │
│   aio-viewer-sp / aio-viewer-sprite / aio-search / aio-client│
│   由 EdgeOne 规则引擎缝成一个域名                             │
└───────────────┬─────────────────────────────────────────────┘
                │ 按 manifest 取资源
                ▼
┌─────────────────────────────────────────────────────────────┐
│ 资产面  COS 桶 + EdgeOne CDN                                  │
│   /3d/ /live2d/ /sp/ /sprite/ /story-media/                  │
│   每目录一份 manifest.json：{path, size, sha256}              │
│   与客户端 config.json 的 EdgeOne 线路（weight 80）同一张网    │
└─────────────────────────────────────────────────────────────┘
```

三个平面各自的**唯一职责**：控制面管"谁能上、挂在哪、超没超预算"；
交付面管"字节怎么发到浏览器"；资产面管"大文件放哪、怎么校验"。

---

## 四、交付面：Pages 项目拆分与路由

### 项目表

| Pages 项目 | 挂载 | 内容 | 预算（外置后） | 备注 |
|---|---|---|---|---|
| `aio-shell` | `/` | 门户、导航、设计系统、状态页 | < 200 文件 / < 20 M | 唯一由 AIO 自己写的代码 |
| `aio-viewer-3d` | `/viewer/3d/` | example-model-viewer `dist` | ~百级 / < 50 M | FBX.gz 外置 |
| `aio-viewer-live2d` | `/viewer/live2d/` | 命名空间 b ADV `dist` | 待实测 | Live2D/HCA 必须外置 |
| `aio-viewer-sp` | `/viewer/sp/` | viewerSP 壳（js 379 + css 3） | < 500 文件 | 48,964 图**全部**外置 |
| `aio-viewer-sprite` | `/viewer/sprite/` | example-sprite-mirror 壳 + cocos2d 引擎 | < 1,000 文件 | 4,025 组精灵外置 |
| `aio-search` | `/search/` | call-search-cn `public/` | 326 文件 / < 90 M | 先清 `node_modules` |
| —（路由规则，非 Pages 项目） | `/story/` | 反代 example-reader 既有 Cloudflare 部署 | — | 见 §六；example-reader 未授予任何开源许可，只能反代 |
| `aio-client` | `/client/` | 客户端下载与线路状态 | 静态 + 1 个函数 | 数据来自线上 config.json |

### 为什么每个查看器是独立文档，不是 SPA 路由

四个查看器的运行时**互相冲突**：

| 查看器 | 运行时 |
|---|---|
| example-model-viewer | three.js 0.182 + 自写 shader |
| ExampleAdv Live2D | Cubism SDK + Pixi（版本已 pin）+ Cocos Studio 特效运行时 |
| example-live2d-viewer | 自带 live2d 运行时 |
| example-sprite-mirror | cocos2d-html5（`js/frameworks/`） |

塞进同一个 SPA，全局变量、WebGL 上下文数量、字体与 CSS 都会打架，而
命名空间 b 那边刚花了一整轮把 Pixi 版本 pin 死（`fix(adv): pin Pixi runtime`）——
再引入版本竞争等于把那轮工作作废。

**做法：同源路径挂载 + 各自独立页面。** 切换查看器走一次整页加载。
代价是 200–500 ms 的白屏，换来的是四条运行时永不相遇。这个取舍值得。

> 不用 iframe：同源子路径已经够隔离（不同 document），iframe 只会额外带来
> 全屏、手势、音频自动播放策略的麻烦，尤其是 Live2D 和 3D 的相机模式。

### 缝合机制

用 EdgeOne 的规则引擎 / `edgeone.json` 的 rewrites 把子路径指向各 Pages 项目。
控制面从 `contracts/*.source.json` **生成**这份路由配置，不手写——手写的路由表
和契约表迟早对不上，而对不上的表现是某个查看器 404，没人会第一时间想到路由。

共享层（顶栏、主题、字体、语言）由 `aio-shell` 提供一份 **注入片段**
（一个 JS + 一个 CSS，都在资产面），各查看器在 `index.html` 里引一行。
不做框架、不做组件库——四条技术栈没有公共框架可言。

---

## 五、资产面

### 桶与目录

```
cos://aio-assets/
  3d/          example-model-viewer 模型（.fbx.gz）与贴图
  live2d/      命名空间 b Cubism 模型、HCA/OGG、WebM
  sp/          viewerSP 的 48,964 张图
  sprite/      example-sprite-mirror 的 4,025 组 ExportJson/plist/png
  story-media/ 剧情插图与语音
  shared/      顶栏注入片段、中文字体、图标
```

### manifest 是唯一的取件方式

每个目录一份 `manifest.json`，构建期生成：

```json
{
  "version": "2026-08-20T00:00:00Z",
  "bases": ["https://assets.<域>/sp/", "https://<备用>/sp/"],
  "files": [{ "path": "100100/d_r0.png", "size": 40213, "sha256": "…" }]
}
```

三件事由此成立：

1. **前端不拼路径，只查 manifest。** 换 CDN、换目录结构不用改前端。
2. **多 base 可回退。** 直接沿用客户端 `CNMirrors` 的思路——第一条不通换下一条。
   客户端已经证明这条路在国内网络环境下是必须的。
3. **hash 认内容。** 与 `baseline.json` 同一原则：地址不是安全边界，
   字节的身份由 sha256 钉死。

### 预压缩

`example-model-viewer` 已经有 `scripts/compress_fbx_gzip.bat` 和一份
`edgeone.json`（给 `*.gz` 打 `Content-Encoding: gzip`）——这套现成的做法
直接提升为资产面的统一约定，对 `.fbx` / `.json` / `.ExportJson` / `.plist` 都适用。

### 下架能力

素材归版权方，`example-restricted-data` 已经有一份 `TAKEDOWN.md`。资产面必须支持
**按目录整片下线**：manifest 里去掉条目 + 桶里删文件，前端自动降级到
"该资源已下架"，不能白屏。这条要在 Phase 2 就做进去，不能事后补。

---

## 六、Story 工位：唯一的难点

`example-reader/website` 现在是 **Next.js 16 + React 19 + OpenNext for Cloudflare**，
跑在 Cloudflare Workers 上，带：

- `SUBMISSIONS_KV`（投稿与限流）
- `SUBMISSIONS_ADMIN_TOKEN` / `PROOFREADING_GITHUB_TOKEN` 两条不可互换的 Worker secret
- Turnstile 人机验证
- 部署门禁 `verify:cloudflare-output` / `verify:cloudflare-config`

它还是**社区校对系统的服务端**，会代表用户建 PR。这不是一个能顺手搬家的东西。

**两条路，建议先走 A：**

| | A. 反代（Phase 3 先做） | B. 迁移到 EdgeOne Functions（Phase 3.5 评估） |
|---|---|---|
| 做法 | AIO 域名 `/story/*` 反代到现有 Cloudflare Worker | OpenNext 换 EdgeOne 适配，KV 换 EdgeOne KV |
| 工期 | 天级 | 周级 |
| 风险 | 跨云一跳延迟；Turnstile 与 Cookie 域要理顺 | 投稿链路的 7 个基准哈希校验必须逐条回归；改坏了会误建 PR |
| 收益 | 立刻拿到统一入口 | 单云、单套密钥、链路可观测 |

**判据**：B 只有在"投稿 → 审核 → 建 PR"全链路能在 EdgeOne 上跑通并通过
`Validate Community Proofreading PR` 那条完整流水线后才算成立。在那之前
A 一直有效。**不要为了"全在 EdgeOne 上"而让一个正在服务真人的校对系统冒险。**

---

## 七、Client 工位

`/client/` 是最容易做、也最有用的一块，因为数据已经在线上：

- **下载线路**：读线上 `config.json` 的 `mirrors[]`，展示各线路名称、权重、
  可用性（边缘函数定时探测，结果写 KV）。
- **版本与强更**：展示 `client` 段的云端版本；展示 `branch_versions` 的
  停止支持开关状态——这正是 CONTRIBUTING §八 那条"禁止更改"约定要求登记的东西，
  现在只能翻 JSON，做成看板后维护者一眼能看出哪个分支版还没退役。
- **APK 下载**：`DOWNLOAD_URLS` 那几条线路，第一条为推荐。

**边界**：`/client/` 只读线上配置，**不写**。客户端的信任锚是写死在包里的
`MIRRORS_URL`，AIO 不能成为第四个信任锚。

---

## 八、契约（Source Contract）

每个上游仓库在 `contracts/` 下有一份，Schema 见 `contracts/aio-source.schema.json`。

```json
{
  "id": "example-model-viewer",
  "repo": "CyberNova2333/example-model-viewer",
  "publish": "allowed",
  "mount": "/viewer/3d/",
  "pages_project": "aio-viewer-3d",
  "build": { "command": "npm ci && npm run build", "output": "dist", "node": "22" },
  "budget": { "files": 400, "bytes": 52428800 },
  "assets": { "prefix": "3d/", "manifest": "manifest.json" },
  "license": "见 docs/CONSTRAINTS.md"
}
```

**分类是人写死在契约里的，不靠脚本推断。** 这条直接抄
`baseline.json` 的原则——自动推断会把"我们故意不发布的东西"误判成
"忘了发布的东西"，而这个误判的代价在 `wiki-data` 和 `example-user-archive` 上
是不可接受的。

---

## 九、AI 能力（Maker 的差异化，放在最后）

EdgeOne Makers 支持 Agent 托管、自动注入模型 key、调用链路采集。可做：

1. **剧情语义检索** —— 在 `example-reader` 的公开面上做（81,338 行剧情）。
   **不能**用 `wiki-data` 的 10,511 条字幕，那边禁止公开。
2. **客户端诊断 Agent** —— 玩家上传 CNLog 分享包，Agent 对着
   README 里那张启动链表（`triggerInstaller` → 15 包 → 序章 → 重启）定位卡在哪一步。
   知识库现成，价值最高。
3. **资料问答** —— 鉴权后台内，基于 Codex 工位。

**这是加分项，不是地基。** 放 Phase 5，且任何一条都不得成为前四个阶段的依赖。

---

## 十、把守卫文化带过来

上游 10 个仓库里，只有 `example-client` 有像样的门禁（23 个 check 脚本、
28 个测试套件、git 钩子硬拦）。其余仓库的通病，AIO 从第一天就要避免：

| 上游的病 | 证据 | AIO 的对策 |
|---|---|---|
| 一次性 workflow 堆积 | `example-search-site` 85 个、`example-model-viewer` 46 个，多为 `apply-*`/`repair-*`/`diagnose-*` | 沿用 legacy-client CONTRIBUTING §八「禁止一次性 Workflow」 |
| 根目录 trigger 文件 | call-search 有 9 个 `.deploy-v22-*-trigger` 空文件 | 用 `workflow_dispatch`，不用文件触发 |
| `node_modules` 入库 | call-search 3,988 个文件 | `.gitignore` + 守卫 |
| 提交信息失控 | example-reader 有 `github-actions[bot]` 作者的英文标题提交 | 沿用 Conventional 前缀 + 中文描述 |
| 预算无人看管 | 无 | `tools/check-sources.py` 的预算检查 |

最后一条是新的，也是最重要的：**撞 Pages 限额时不报错**，只是部署失败或者
部分文件静默缺失。必须在推上去之前就红灯。

---

## 待验证项（开工前必须复核）

1. EdgeOne Pages 的三个限额数字（5 GiB / 20,000 文件 / 25 MiB）——本文数据
   来自第三方文章，官方文档站当时 503。**必须以控制台与官方文档为准**，
   限额若不同，§四的项目拆分要重算。
2. EdgeOne Pages 对 Next.js 16 + React 19 的 SSR 支持程度，以及 KV 的
   配额与一致性语义（决定 §六 走 A 还是 B）。
3. EdgeOne Pages Functions 的 CPU 时间 / 内存 / 请求体上限。
4. 自定义域名的 ICP 备案要求（国内加速必须备案；海外区域不需要），
   以及"Cloudflare 托管的根域名暂不支持绑定"这条对现有域名的影响。
5. COS 与 EdgeOne 回源的计费口径——资产面预计 20 GiB 量级、以图片小文件为主。

## 待拍板事项（需维护者决定，方案不替你决定）

1. **Codex 工位到底做不做。** `example-restricted-data` 的公开部署禁令是 CI 硬约束，
   本方案默认**遵守**，把资料能力放进鉴权后台。要公开必须由你解除禁令。
2. **Story 走 A 还是 B。** 本方案默认 A（反代先行）。
3. **域名与备案。** 有没有已备案的域名可用？没有的话首发只能走海外加速区域。
