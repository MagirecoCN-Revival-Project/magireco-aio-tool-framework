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
src/station/    骨架期数据与占位插件
src/cms/        CmsStore 接口 + 内存实现
src/app/        路由：/ 资料页、/admin 后台
```

## 哪些是真的，哪些是占位的

**真的**：`Kernel`、`Registry`、`ResourceClient`、`OriginPool` 全部从 `packages/`
原样 import；manifest、能力声明、生命周期、事件总线、多源选路、
`can()` 决定按钮画不画、插件装卸——都是生产路径。

**已经是真的**：三个插件全是真实现——`sprite-viewer` 装 `@aio/plugin-sprite` +
`createCanvas2dStage`（骨骼真解析、帧真插值、canvas 上真画），`adv-player` 装
`@aio/plugin-adv` + `createDomStage`（worksheet 真解析、时间轴真推进、
对话框真渲染），`model-3d` 装 `@aio/plugin-gltf`（glTF 2.0 真解析）。骨骼数据是合成的（铁律 9：素材不进这棵树），
经 `data:` URL 由 `StaticProvider` 送进来，所以整条链路（fetch → 解析 → 推帧 → 渲染）
都是生产路径。资源提供者也从 `ManifestCdnProvider` 换成了 `StaticProvider`，
**插件与宿主一行没改**——那是 ADR 0002 第一层判据的实际兑现。

**占位的**：

- **一个占位都不剩了**：`model-3d` 也换成了 `@aio/plugin-gltf`。
  缺的只是「画得多好看」——贴图与真渲染要等资源面（Phase 2）与各自的 WebGL 舞台。
- 隔离级别：契约里 `sprite-viewer` / `adv-player` 是 `iframe`，占位版没有那些
  全局运行时，所以按 inline 走。接真查看器时用 `createIframePlugin()` 包一层，
  **调用方一行不用改**。
- CMS 的 2/3/4 块没有持久化，刷新即失忆。EdgeOne Pages 是静态托管，写入面要等
  Phase 5 的边缘函数 + KV；接口已经钉死在 `src/cms/store.ts`，换实现时上层不动。

## 🔴 资源与代码分离（铁律 9）

这个目录里**没有、也不会有**任何版权素材。`src/station/data.ts` 存的是
*路径字符串*，指向资源面（COS + EdgeOne CDN）；素材经 `host.resources` 按 ref 取。
`tools/check-assets.py` 会拦下任何试图把素材放进来的改动，CI 里也有一份。

`next.config.mjs` 里 `images.unoptimized = true` 就是这个的直接后果——
没有本地图片需要优化，因为一张都没有。
