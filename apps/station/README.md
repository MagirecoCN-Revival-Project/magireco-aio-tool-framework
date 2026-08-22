# AIO 工作站（`apps/station`）

**带插件的 CMS 宿主。** Next.js（App Router）+ React 19，交付到 EdgeOne Pages。

```bash
npm install
npm run -w @aio/station dev      # http://localhost:3000
npm run -w @aio/station build    # 静态导出到 apps/station/out/
```

> 两条命令都带 `--webpack`。Next 16 起 Turbopack 是缺省打包器，而
> `packages/` 里的相对 import 带 `.js` 后缀（TS 写 ESM 的正确写法），
> Turbopack 目前没有 webpack `extensionAlias` 的对应物——2026-08-21 实测
> 拿掉之后 51 个 `Can't resolve './xxx.js'` 全部复现。理由与取舍写在
> `next.config.mjs` 的注释里。

## 它和 `apps/demo` 的分工

| | `apps/demo` | `apps/station` |
|---|---|---|
| 目的 | 回答「这框架能干嘛」 | **真正要上线的宿主** |
| 技术栈 | 无框架，esbuild 单文件 | Next.js + React |
| 隔离演示 | 有真的 iframe RPC | 骨架期全 inline |
| CMS | 无 | 有（四块） |

demo **不要删**：它是「宿主可以是任何技术栈」的活证据，也是调试内核时最小的复现环境。

## 这里真正解决的问题：React ↔ 内核的 surface 桥

内核的 `acquire()` 是**同步**的，必须当场返回一个能挂载的 DOM 容器；
React 的渲染是异步的，容器要等下一次 commit 才存在。

解法在 `src/kernel/surface-store.ts` + `SurfaceOutlet.tsx`：

1. `acquire()` 当场 `document.createElement` 造一个**游离**容器交给插件，插件立刻能画；
2. React 订阅 store，渲染各自的外框，用 ref 回调把这个游离节点 `append` 进去。

**React 永远不去重渲染那个节点的内容。** 这是必须的：three.js / cocos2d
直接持有 DOM 与 WebGL 上下文，React 若把它们当受控内容重建，画面就没了。

换 Vue 或 Svelte 时要重写的只有 `SurfaceOutlet`——`surface-store.ts` 与整个
`packages/` 一行都不用动。这就是「宿主不止一个」在代码层面的样子。

## 目录

```
src/kernel/     内核接线：Station 单例、surface 桥、React context
src/station/    骨架期数据、插件目录、能力→插件 id 的推导
src/cms/        CmsStore 接口 + 内存实现
src/app/
  (site)/       站点：/ 资料页、/admin 后台（带顶栏与版心）
  embed/        嵌入面：/embed/<能力>?ref=…（无外壳，给别的站嵌）
```

## 嵌入面

别的站（合作的 wiki）放一个 iframe 就能拿到我们的查看器。整套判定在
`@aio/embed`，宿主这边分两半：

| | 谁做 | 做什么 |
|---|---|---|
| 构建期 | `app/embed/[capability]/page.tsx` | 烘出 6 个页，随后由 `tools/pack-embed-pages.mjs` **搬进函数的包、从 `out/` 删掉** |
| 请求期 | 仓库根的 `functions/embed/[capability].js` | `resolveEmbed()` 判准入，然后自己吐 HTML 并带上 CSP |

**为什么要把产物搬走**：EdgeOne Pages 在路由冲突时**静态优先**——`out/embed/`
只要还在，边缘函数就永远不触发，下架判定、插件开关与 `frame-ancestors`
整个失效，而且不报错。`test/embed-pages.test.ts` 盯着这条不变量。

客户端也判一次，但**那不是安全边界**——它只解决「本地开发没有边缘函数时，
得有个东西告诉你为什么是空的」。细节见
[`docs/guide/embed.md`](../../docs/guide/embed.md)。

嵌入面不套站点外壳，所以顶栏与版心挪进了 `app/(site)/layout.tsx`；
根 layout 只剩 `<html>`、`<body>` 与 `KernelProvider`——**内核仍是单例**。

## 哪些是真的，哪些还缺

**真的**：`Kernel`、`Registry`、`ResourceClient`、`OriginPool` 全部从 `packages/`
原样 import；manifest、能力声明、生命周期、事件总线、多源选路、
`can()` 决定按钮画不画、插件装卸——都是生产路径。

**四个插件全是真实现，一个占位都不剩**：

| 目录 id | 装的是 | 真的做了什么 |
|---|---|---|
| `sprite-play` | `@aio/plugin-sprite` + `createCanvas2dStage` | 骨骼与图集真解析、父子变换真合成、帧真插值、canvas 上真画 |
| `adv-play` | `@aio/plugin-adv` + `createDomStage` | worksheet 真解析、时间轴真推进、对话框真渲染 |
| `model3d-gltf` | `@aio/plugin-gltf` | glTF 2.0 真解析（动画清单、外部依赖） |
| `chart-height` | `@aio/plugin-chart` + `createDomStage` | 档案真解析、比例真算、没登记身高的真说出来 |

数据是合成的（铁律 9：素材不进这棵树），经 `data:` URL 由 `StaticProvider` 送进来，
所以整条链路（fetch → 解析 → 推进 → 渲染）都是生产路径。资源提供者也从
`ManifestCdnProvider` 换成了 `StaticProvider`，**插件与宿主一行没改**——
那是 ADR 0002 第一层判据的实际兑现。

> **目录 id 必须等于插件 manifest 的 id。** `Station.disable()` 拿目录 id 去
> `kernel.unregister()`，对不上时它会静静地什么都不做：后台开关看着关了，能力
> 其实还在。`test/catalog.test.ts` 逐条钉住这件事，并验「拔掉之后 `can()` 变假、
> 其余能力不受影响、装回来能力就回来」。

**还缺的**：

- 「画得多好看」——贴图与真渲染要等资源面（Phase 2）与各自的 WebGL 舞台。
- 隔离级别：契约里 `sprite-viewer` / `adv-player` 那几个**上游**实现是 `iframe`，
  因为它们靠 `window.cc` 这类全局活着。这里装的四个从零实现没有那些运行时，
  所以按 inline 走。接真查看器时用 `createIframePlugin()` 包一层，
  **调用方一行不用改**。
- CMS 的 2/3/4 块没有持久化，刷新即失忆。EdgeOne Pages 是静态托管，写入面要等
  Phase 5 的边缘函数 + KV；接口已经钉死在 `src/cms/store.ts`，换实现时上层不动。

## 🔴 资源与代码分离（铁律 9）

这个目录里**没有、也不会有**任何版权素材。`src/station/data.ts` 存的是
*路径字符串*，指向资源面（COS + EdgeOne CDN）；素材经 `host.resources` 按 ref 取。
`tools/check-assets.py` 会拦下任何试图把素材放进来的改动，CI 里也有一份。

`next.config.mjs` 里 `images.unoptimized = true` 就是这个的直接后果——
没有本地图片需要优化，因为一张都没有。
