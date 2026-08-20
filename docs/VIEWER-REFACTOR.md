# 查看器改造：三种活，只有一种是重写

> **⚠️ 这份是迁移手册，不是终局描述**（[ADR 0002](adr/0002-抽象成资源可插拔的开源系统.md)）。
> 下面每一条改造结论都仍然有效——它们是**怎么把既有查看器接成某个能力的
> 第一个实现**。终局是能力契约 + 一致性套件，适配器是通往那里的桥。
> 「不用重写」说的是**现在**不用，不是「永远不会有第二个实现」。

> 结论先说：**四个查看器没有一个需要重写。** 但它们要做的事完全不同，
> 按同一套流程推会在最糟的那个上卡死。

## 判据：不需要它干净，只需要一条缝

把一个既有查看器变成插件，**不需要它的代码是干净的**。只需要两条缝：

1. **资源从哪来**——能不能换成运行期注入，而不是构建期绑死；
2. **怎么告诉它显示什么**——有没有一个能被外部调用的入口。

适配层负责吸收剩下的脏。缝切开之后再增量重构，那时适配层的测试就是安全网。

---

## 逐个体检（2026-08-20 实测）

### example-model-viewer —— 几乎不用改 ✅

```
src/main.ts                          5 行
upstream-three-subpackage/      889 行，独立子包，有 JSDoc 与 peerDependencies
```

渲染逻辑**早就抽干净了**：`CharacterManager` 是个正经的库，
`src/main.ts` 只有 5 行，应用层是薄壳。

更关键的是，它的构造函数签名本身就是注入式的：

```ts
constructor(files: Record<string, string>)   // 路径 → URL
```

而且**文档里明确写了可以传任意 URL**：

> `@example` You can also use your own models:
> `new CharacterManager({ "chara_100101/acc_color.png": "http://…/acc_color.png" })`

现在应用侧用 `import.meta.glob` 在**构建期**把模型打进 dist。要外置资源，
只需要换成从清单构造同一个 `Record`：

```ts
const files = await buildFilesFromManifest(host.resources, characterRef);
const characters = new CharacterManager(files);
```

**改动量：一个函数。** 子包一行不用动。

> 注意 `getCharacterIdList()` 是从 `files` 的 key 反推 ID 的
> （正则 `chara_(\d+).*\/`）。改成运行期注入后，"有哪些角色"要改由交叉表回答，
> 不能再指望它从文件名扫出来——清单是按需加载的，不会一次性给全。

### example-adv-live2d —— 缝已经在了，但被一个巨型文件挡着 ⚠️

```
src/main.ts              2,377 行   ← 把所有东西接在一起的上帝文件
src/story/advEngine.ts     802 行   ← 有 AdvEngineCallbacks 接口，可外部驱动
src/assetPaths.ts                  ← 资源 URL 已经集中在这里了
tests/                      91 个   ← 大量是与真机 AArch64 实现的交叉核对
```

两条缝**都已经存在**：

- `AdvEngine` 是导出的 class，配 `AdvEngineCallbacks`——本来就是回调驱动的，
  适配层挂上去就行。
- `assetPaths.ts` 已经把资源地址集中成了 `ASSET_BASE` + 若干拼装函数
  （`recordModelUrl` / `voiceUrl`），**这就是资源层要替换的那一个模块**。

真正的障碍是 `main.ts` 那 2,377 行：它同时负责 UI 装配、生命周期、事件绑定。
插件只需要 `AdvEngine`，不需要那个壳。

**做法**：不动 `main.ts`（那是它自己作为独立站点的入口），
另写一个 `src/embed.ts` 暴露最小挂载函数，与 `main.ts` 并存。
`main.ts` 的重构可以永远不做。

**不要重写这个。** 91 个测试里有一批是把行为钉死在真机原生实现上的
（StoryMessage 几何、tap 动画常量、Story 字体），重写等于把那些结论全丢掉，
然后在真机上重新踩一遍。

### example-sprite-mirror —— 小而脏，最适合原地整理 ⚠️

```
main.js     357 行   自己写的 IIFE，state 对象 + 一堆 function
viewer.css  226 行
```

问题很直白：

```js
var base = "../assets/sprites/";        // 资源路径写死在函数里
elements[id] = document.getElementById(id);   // DOM id 写死
```

没有任何对外接口——它是个页面，不是个组件。

但它只有 357 行，而且**是自己写的代码**（不像 cocos2d 框架那 8,000 个文件）。
把 `base` 提成参数、把 `selectUnit(unit, variant)` 暴露出去，就够了。

**改动量：半天。** 它反而是四个里最容易的。

### example-live2d-viewer —— 最脏，也最该往后放 🔴

```
js/*.js       1,002 行自己的代码
js/frameworks   367 个文件（引擎）
image/       48,964 张图
```

资源路径**嵌在业务逻辑中间**，还挂在全局上：

```js
window.bg_res = "image/image_native/bg/web/web_0015.ExportJson"
```

这不是"改一个 base"能解决的——路径散落在赋值语句里，且通过 `window` 传递。

**做法**：不改源码，在 iframe 内装一层 **fetch/XHR 拦截器**，把
`image/**` 的请求改写到资源层给出的 URL。脏，但：
- 它已经在 iframe 里（自带 live2d 运行时，必须隔离）；
- 拦截器是**一个文件**，不散布在 1,002 行里；
- 48,964 张图的外置收益极大，而源码改造收益很小。

等真有人要重构它的时候再重构。**排 Phase 3 最后**。

---

## 汇总

| 查看器 | 资源缝 | 接口缝 | 改动量 | 手法 |
|---|---|---|---|---|
| example-model-viewer | ✅ 构造函数已是注入式 | ✅ 独立子包 | **一个函数** | 换 `Record` 来源 |
| ExampleAdv ADV | ✅ `assetPaths.ts` 已集中 | ✅ `AdvEngineCallbacks` | 新增 `embed.ts` | 绕开 `main.ts` |
| example-sprite-mirror | ❌ 写死在函数里 | ❌ 完全没有 | 半天 | 提参数 + 暴露入口 |
| example-live2d-viewer | ❌ 散落 + 挂 `window` | ❌ 完全没有 | 一个拦截器 | 不改源码，拦请求 |

**三种活**：换一个参数、加一个入口、拦一层请求。**没有一个是重写。**

---

## 两条铁律

### 1. 上游仓库保持可独立运行

每个查看器改造后，`npm run dev` 必须照样能单独跑起来。插件入口是**新增**的，
不是替换。理由：
- 它们各自有用户与部署，断掉就是回归；
- 单独可跑是最好的调试手段——插件里出问题，先回单站看是不是本来就坏；
- 上游作者不必接受"必须在 AIO 里才能开发"这个前提，否则协作会崩。

### 2. 资源改造先于接口改造

先把资源换成运行期注入，再谈接口。反过来做的话，接口通了但资源还绑在构建期，
插件一装就把几个 G 塞进部署产物，撞 Pages 限额——而**撞限额时不报错**。
