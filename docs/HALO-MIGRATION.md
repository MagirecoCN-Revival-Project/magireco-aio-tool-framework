# 接入 Halo：迁移评估

> 决定见 [`AIO-ARCHITECTURE.md`](./AIO-ARCHITECTURE.md) 待拍板第 4 条（已结）。
> 这份文件回答的是「接进去之后，我们还剩多少东西要自己写」。
>
> **标注约定**：✅ = 已查证（官方模板 / 官方文档 / 官方插件库）；
> 🚧 = 推断，动手前要验。这个区分在本项目吃过亏，不含糊。

## 一句话

**接 Halo 之后，我们要写的东西比现在少一半，而且铁律 11 不再是难题。**

---

## 一、Halo 插件长什么样（✅ 跑过官方模板）

`pnpm create halo-plugin` 生成的是 **Gradle + Java 后端 + TypeScript 前端**：

```
build.gradle          Java 21，Halo 2.26，run.halo.plugin.devtools
src/main/java/        后端：extends BasePlugin，有 start() / stop()
src/main/resources/
  plugin.yaml         spec.enabled ← 就是那个开关
ui/                   前端：Vue 3 + TypeScript，vitest ^4.1.10
  src/index.ts        definePlugin({ components, routes, extensionPoints })
```

三件事直接对上了我们已有的形状：

| Halo 的东西 | 对应我们的什么 |
|---|---|
| `plugin.yaml` 的 `spec.enabled` | **铁律 10 那「一个开关」** |
| `BasePlugin.start()` / `stop()` | `kernel.register()` / `unregister()` |
| `ui/` 是 TypeScript（vitest 同大版本） | 浏览器侧代码原样住进去，不用移植 |

> Halo 的 `ui/src/index.ts` 里也有个 `definePlugin`——和 `@aio/plugin-sdk`
> 的同名函数是两回事（那边描述控制台路由与扩展点，这边描述能力与生命周期）。
> 写代码时别混。

---

## 二、我们的东西怎么分（✅ 已有代码，分法确定）

| 层 | 去哪 | 要不要重写 |
|---|---|---|
| `@aio/core` `resource` `registry` `kernel` | 插件的 `ui/` | **不用**，纯 TS |
| 6 个能力插件 | 同上 | **不用** |
| `@aio/capability`（契约） | 同上 | **不用** |
| `@aio/site`（路由 / SEO / sitemap / 导航） | — | **大部分退休**，见下 |
| 嵌入面准入 + 下架判定 | `src/main/java/` | **要一份 Java** |
| `apps/station` | — | 降级为**参考宿主**，不再是交付目标 |

`apps/station` 不删。它是「宿主可以是任何技术栈」的活证据，也是调试内核时
最小的复现环境——和 `apps/demo` 一个道理（铁律 6 的同源判据）。

### `SurfaceOutlet` 那一句话应验了

`apps/station/README.md` 里写着：

> 换 Vue 或 Svelte 时要重写的只有 `SurfaceOutlet`——`surface-store.ts` 与整个
> `packages/` 一行都不用动。

Halo 的 `ui/` 正是 Vue。所以浏览器侧要写的新代码，**就是一个 Vue 版的
`SurfaceOutlet`**（约 40 行：订阅 store，用 ref 回调把游离容器 append 进去，
永远不去重渲染它的内容）。

---

## 三、生态里现成的东西（✅ 通读了 198 条，不是摘要）

[`halo-sigs/awesome-halo`](https://github.com/halo-sigs/awesome-halo) 共 198 条。
按**对我们的用法**分三档，别混为一谈——「能装上就用」和「能抄渲染层」
和「只是模式参考」是三件事。

### 甲档：装上就用，不用写代码

| 插件 | 顶掉我们的什么 | 对应阶段 |
|---|---|---|
| `plugin-s3`（官方，**含腾讯云**） | 资源面的对象存储对接 | Phase 2 |
| `attachment-upload-cli`（官方） | 20 GiB 素材的批量上传 | Phase 2 |
| `plugin-cdn-cache`（**含腾讯云**） | 下架时的 CDN purge | 铁律 11 |
| `plugin-sitemap` `plugin-feed`（官方） | `@aio/site` 的 sitemap 与订阅 | — |
| `plugin-IndexNow` `halo-plugin-sitepush` `plugin-time-factor` | SEO 收录推送，我们本来没做 | — |
| `plugin-meilisearch` `plugin-search-widget`（官方） | 站内全文搜索 | — |
| `plugin-oauth2`（官方）`auth-passkey` `halo-plugin-register`（邀请码）`global-private`（白名单） | **鉴权后台整块** | Phase 5 |
| `plugin-download-links` | **APK 分发的下载卡片** | Phase 5 |
| `plugin-redis-connector` | 下架清单的强一致存储 | 铁律 11 |
| `plugin-aimodel-hub` | 统一的 AI 模型调用 | Phase 6 |
| `plugin-maintenance` | 维护模式（应急收缩可见面） | — |

> `search.query` 是**按 ref 检索实体**的能力（角色称呼等），
> `plugin-meilisearch` 是**站内全文搜索**。两者不冲突也不互相替代，别合并。

### 乙档：拿来当渲染层，但要适配

**这一档最有价值的是 Live2D**，因为它对上的正是我们最大的缺口之一
——能力盘点里写着「Cubism 真渲染没有」。

| 插件 | 许可 | 它解决了什么 |
|---|---|---|
| [`LIlGG/plugin-live2d`](https://github.com/LIlGG/plugin-live2d) | **MIT** | **Cubism 2/3/4/5 全系模型**、换装换肤、自定义接口与工具栏 |
| [`alsdhkauuhw/halo-plugin-live2D`](https://github.com/alsdhkauuhw/halo-plugin-live2D) | GPL-3.0 | 表情切换、**高 DPI**、IndexedDB 缓存、自定义模型路径 |

两者许可都与本仓库的 GPLv3 兼容。

**但它们不是能直接用的能力提供者**，说清楚差在哪：

- 它们是**看板娘**（页面角落的挂件），不是按 ref 寻址的查看器；
- 模型从**配置好的路径**加载——那正是铁律 3 禁止的（插件不碰 URL）；
- 不发 `entity.focused`，没有能力契约，没有 surface 生命周期；
- alsdhkauuhw 那个**内置了游戏模型**，我们不能用（铁律 9，版权素材）。

所以正确的用法是：**只取渲染层，装进我们的 `createStage`**。

```ts
createLive2dPlugin({ createStage: /* ← 这里放一个 Cubism 舞台 */ })
```

`@aio/plugin-live2d` 的舞台本来就是注入式的（六个插件全是这个形状），
ref 解析、清单查表、下架降级、事件回流仍然走我们这边。
**难的那一半（Cubism SDK 打包、WebGL 上下文、高 DPI、模型加载）它们做完了。**

同一档还有：

| 插件 | 能给我们什么 |
|---|---|
| `halo-plugin-aplayer` / `plugin-navidrome-player` | 音频播放器。我们有 `voice` 这个 RefKind，**却还没有对应能力** |
| `plugin-dplayer` | 视频播放器，ADV 若要接视频演出可用 |
| `plugin-photos`（官方） | 图库管理，与 `sprite` / `image` 的展示面相关 |

### 丙档：只是模式参考

- **`plugin-shortcode`** —— 编辑器通用标签 + **「只在实际用到时才加载对应 CSS/JS」**。
  这正是我们六个能力该有的加载策略：一篇文章没插精灵查看器，就别下发
  精灵那一坨。
- **`plugin-thyuu-embed` / `plugin-dplayer` / `plugin-timeline` /
  `plugin-data-statistics`** —— 编辑器区块的做法。我们的能力走这条路比 iframe
  自然，见下。
- **`plugin-bilibili-bangumi` / `plugin-douban` / `plugin-steam` /
  `plugin-bangumi-data`** —— 全是「取外部数据 → 提供路由 + 给主题喂数据」，
  结构上与我们的交叉表 + `/character/:id` 一模一样。写路由时照着来。
- **`global-private` / `halo-private-posts` / `plugin-safe-redirect`** ——
  请求拦截与访问控制的实际写法，是验证铁律 11 那个 🚧 的最好样本。

### 一个更 native 的形态：编辑器区块

`plugin-thyuu-embed` 那类是**编辑器区块**——作者在文章里插一个块，前台渲染。
我们的六个能力完全可以走同一条路：

```
编辑文章时插入「精灵查看器」区块 → 填 ref → 前台渲染我们的查看器
```

这比 iframe 嵌入面自然得多，而且**绕开了整个准入问题**：内容在我们自己的
站里，下架由 Halo 的内容状态直接管。

**iframe 嵌入面仍然要留**——那是给 wiki 那边用的，跨站就只能走 iframe。
两条路各有各的用处，不是替代关系。

## 四、铁律 11 不再是难题（✅ 前提成立，🚧 具体扩展点待验）

之前那个死结是 EdgeOne 特有的：静态优先导致函数不触发，而规则引擎与重建同速。

Halo 是一台**正常的服务器**：每个请求都经过它，读一次数据库/缓存没有边际计费。
所以「请求期现读下架清单」这件事回到了它本该有的样子——不必在
「全量换 Function」「分级」「改铁律 11」之间做取舍。

🚧 **动手前要验**：Halo 插件拦截/否决一次内容请求的确切扩展点。
社区里 `global-private`（全局访问控制）、`plugin-safe-redirect`（重定向中间件）
证明请求拦截是可行的，但具体 API 要照文档写。

---

## 五、Java 那一份怎么保证不跑偏（✅ 已就位）

要写 Java 实现，就有重复实现的风险。**这个风险本仓库实测过**：
MediaWiki 那份 PHP 的 ref 预检与 `parseRef` 在 22 条样本里分歧 2 条，
其中一条放过了 `a:character/../etc`——路径穿越的形状，而 wiki 上看着一切正常。

所以判据不能只活在 TS 里：

- `packages/embed/src/corpus.ts` —— 20 条**纯数据**用例，覆盖铁律 1 / 10 / 11
  与参数容忍度；
- `packages/embed/corpus.generated.json` —— 同一份语料的 JSON，
  JUnit 直接读得动；
- 参考实现 `resolveEmbed()` **自己也过这份语料**——它只是第一个实现，
  不是标准答案。

Java 实现写完，拿这 20 条对账，条条对上才算接进来。

---

## 六、建议的第一步

**不要先迁移，先验证前提。** 做一个最小插件骨架，只做三件事：

1. `ui/` 里挂上 `@aio/kernel` 与**一个**插件（`chart.height` 最轻，纯 DOM、
   不占 WebGL），配一个 Vue 版 `SurfaceOutlet`；
2. Java 侧用 `RouterFunction` 注册 `/embed/{capability}`，实现准入判定；
3. 跑那 20 条语料对账。

这一步能一次性回答三个前提：Halo 的 `ui/` 吃不吃我们的 TS 包（我们的
`main` 指向 TS 源码，要宿主打包器转译）、`RouterFunction` 够不够用、
Java 实现能不能与语料对齐。

三个都过了再谈整体迁移；任何一个不过，现在知道比迁一半才知道便宜得多。
