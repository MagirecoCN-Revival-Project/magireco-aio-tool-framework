# 装上并跑起来

## 前提

- **Node ≥ 22**（`package.json` 的 `engines` 钉死了）
- **Python 3**（守卫脚本用，不装第三方库也能跑；装了 `jsonschema` 会多跑一遍完整 schema 校验）

## 五分钟

```bash
git clone https://github.com/MagirecoCN-Revival-Project/magireco-aio-tool-framework
cd magireco-aio-tool-framework
npm install
```

::: warning 先接一次电
git 钩子是**每份克隆的本地配置**（`core.hooksPath`），入库文件没法让它自动生效
——这是 git 有意为之的安全设计，否则 clone 一个仓库就等于执行任意代码。
所以第一次进来先自检一句：

```bash
git config --get core.hooksPath   # 应输出 tools/githooks
bash tools/install-hooks.sh       # 空的就跑这个
```

同一套判据另有一份跑在 CI 里，**不依赖任何本地配置**——钩子漏了它还在。
:::

## 命令表

| 命令 | 做什么 |
|---|---|
| `npm run check` | typecheck（strict）+ 全部测试 + 契约守卫 + 资源分离守卫。**提交前跑这个** |
| `npm test` | 只跑测试（vitest，全部在 node 上，不需要浏览器与 GPU） |
| `npm run typecheck` | 只跑 `tsc -p tsconfig.json` |
| `npm run -w @aio/station dev` | 启动宿主，`localhost:3000` |
| `npm run -w @aio/station build` | 静态导出到 `apps/station/out/` |
| `npm run docs:dev` | 本文档站的本地预览 |
| `python3 tools/test-check-sources.py` | 契约守卫自测：27 个坏样本必须全被拦下 |
| `python3 tools/test-check-assets.py` | 资源分离守卫自测 |
| `python3 tools/test-build-manifest.py` | 清单生成器自测 |

::: tip station 的 dev/build 都带 `--webpack`
Next 16 起 Turbopack 是缺省打包器，而 `packages/` 里的相对 import 带 `.js` 后缀
（TS 写 ESM 的正确写法），Turbopack 目前没有 webpack `extensionAlias` 的对应物
——2026-08-21 实测拿掉之后 51 个 `Can't resolve './xxx.js'` 全部复现。
:::

## 仓库长什么样

```
packages/            15 个包，全部 main 指向 TS 源码（没有构建产物，故意的）
  core/              ref 语法、能力/意图、事件总线。零依赖
  registry/          实体交叉表
  resource/          ResourceProvider 接口 + 两个实现
  kernel/            浏览器半边：注册、派发、surface 生命周期、WebGL 治理、iframe 桥
  site/              边缘半边：路由、SSR 元信息、SEO、站点配置、下架
  plugin-sdk/        definePlugin + 无头测试宿主
  capability/        六份能力契约
  conformance/       一致性套件（不 import 任何具体实现）
  plugin-*/          七个实现：sprite / adv / live2d / gltf / search / chart / model-3d
apps/
  station/           带插件的 CMS 宿主（Next.js + React 19，静态导出）
  demo/              无框架、esbuild 单文件——「宿主可以是任何技术栈」的活证据
contracts/           每个上游如何成为插件；capabilities.json 横着记能力与实现
tools/               守卫与生成器（Python，无第三方依赖）
docs/                设计文档 + 本站
```

::: info 包为什么不带构建产物
`main` 直接指向 `src/index.ts`。它们要能被**任何**宿主直接 import，
而不是先经过我们这边的一次打包。代价是打包器得会把 `./x.js` 解析到 `./x.ts`
（见上面那条 `--webpack`），收益是这些包对下游没有构建假设。
:::

## 在自己的宿主里用

框架不要求你用 `apps/station`。装一个内核、注册几个插件就行：

```ts
import { Kernel, type SurfaceProvider } from '@aio/kernel';
import { Registry } from '@aio/registry';
import { StaticProvider } from '@aio/resource';
import { parseRef } from '@aio/core';
import { createSpritePlugin, createCanvas2dStage } from '@aio/plugin-sprite';

const kernel = new Kernel({
  resources: new StaticProvider({ entries: { /* ref → part 列表 */ } }),
  registry: Registry.empty(),
  surfaces: mySurfaceProvider,       // 你的宿主怎么给容器，见下
});

kernel.register(
  createSpritePlugin({
    createStage: (container, ctx) => createCanvas2dStage(container, ctx),
    usesWebGL: false,
  }),
);

const ref = parseRef('a:sprite/100100/d_r');
if (kernel.can('sprite.show', ref)) {
  await kernel.request({ capability: 'sprite.show', ref, surface: 'inline' });
}
```

`SurfaceProvider` 只有两个方法——**`acquire` 必须同步返回一个能挂载的容器**：

```ts
interface SurfaceProvider {
  acquire(surfaceId: string, hint: SurfaceHint, pluginId: string): SurfaceTarget | null;
  release(surfaceId: string): void;
}
```

React 宿主怎么解决「同步要容器 / 异步才渲染」这对矛盾，见
[内核那一页](/guide/kernel#react-宿主的-surface-桥)。测试里直接用
`createHeadlessSurfaceProvider()`，整套内核逻辑在 node 上就能跑完。

## 下一步

- [六个能力，怎么用](/guide/capabilities) —— 每个能力的 ref、参数、事件
- [资源面](/guide/resources) —— ref 语法与 provider
- [写一个插件](/PLUGIN-AUTHORING)
