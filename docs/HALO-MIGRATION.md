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

## 三、生态里现成的东西，替我们干掉一批活（✅ 来自官方插件库）

[`halo-sigs/awesome-halo`](https://github.com/halo-sigs/awesome-halo) 里能直接用上的：

| 插件 | 顶掉我们的什么 |
|---|---|
| `plugin-sitemap`（官方） | `@aio/site` 的 sitemap 生成 |
| `plugin-feed`（官方） | 订阅面，我们本来没做 |
| `plugin-s3`（官方，含腾讯云） | **资源面的对接**（Phase 2 的一大块） |
| `plugin-cdn-cache`（含腾讯云） | 下架时的 **CDN purge** |
| `plugin-meilisearch` / `plugin-search-widget` | 站内搜索（与我们的 `search.query` 是两件事，见下） |
| `plugin-injector` | 往指定页面注入 HTML，可用于挂我们的 bundle |

> `search.query` 是**按 ref 检索实体**的能力（角色称呼等），
> `plugin-meilisearch` 是**站内全文搜索**。两者不冲突也不互相替代，别合并。

### 一个更native的形态：编辑器区块

`plugin-thyuu-embed`、`plugin-dplayer` 这类是**编辑器区块**——作者在文章里插一个
块，前台渲染成播放器。我们的六个能力完全可以走同一条路：

```
编辑文章时插入「精灵查看器」区块 → 填 ref → 前台渲染我们的查看器
```

这比 iframe 嵌入面自然得多，而且**绕开了整个准入问题**：内容在我们自己的
站里，下架由 Halo 的内容状态直接管。

**iframe 嵌入面仍然要留**——那是给 wiki 那边用的，跨站就只能走 iframe。
两条路各有各的用处，不是替代关系。

---

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
