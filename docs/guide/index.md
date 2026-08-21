# 这是什么

一个开源框架，把散落在 10 个仓库里的能力缝成一套系统；外加它的控制面
（契约、策略、守卫）。

判据只有一条：

> 模块之间**不互相 import、不知道对方存在**，却能互相调用并回话。
> 少装一个模块，宿主依然自洽，只是少一项能力。

看剧情时点一下，ADV 插件就地实机播放，并把行号回传给阅读器高亮；
看角色档案时点一下，精灵查看器就地显示——而档案页从未 import 过它。

## 三层

自下而上，每一层都能被单独替换：

```
┌─ 宿主与 UI ──────────────────────────────────────┐
│  apps/station（Next.js + React）、apps/demo、    │
│  或者任何第三方宿主——example-reader 装一个插件      │
│  就多一项能力，主权不变                          │
├─ 能力契约 ───────────────────────────────────────┤
│  @aio/capability   每个能力**能被怎么用**   │
│  @aio/conformance  一致性套件（不 import    │
│                         任何具体实现）           │
├─ 可插拔资源 ─────────────────────────────────────┤
│  ResourceProvider 接口                           │
│    ├ ManifestCdnProvider  清单 + 多源回退 + sha256│
│    └ StaticProvider       离线包／本地目录        │
└──────────────────────────────────────────────────┘
      ↑ 中间穿过两半：
        @aio/kernel  浏览器侧——注册、派发、surface
                          生命周期、WebGL 治理、iframe 桥
        @aio/site    边缘侧——路由、SSR 元信息、SEO、
                          站点配置、下架。与浏览器侧**共用
                          同一个插件 id**，一个开关管两边
```

设计推理见 [ADR 0002](/adr/0002-抽象成资源可插拔的开源系统)。

## 为什么不是「一堆适配器」

适配器模型下，「换一个 3D 实现」意味着改宿主；系统模型下，它意味着换一个满足
同一份契约的包，宿主一行不动。

这个区别不是措辞。维护者的约束是**不改上游**：

> 这是开源仓库，直接去改上游第一不合适、第二容易牵出许可证问题。

`example-reader` 未授予任何开源许可，`example-live2d-viewer` 是他人仓库。以「改上游加一个
插件入口」为主路径，等于把项目建在别人是否接受我们改动、以及那些改动的许可状态
上。契约先行则反过来：我们自己的实现不依赖任何一个上游而存在。

所以现在**六个能力各有一个从零写、一行上游代码都不碰的实现**，全部过一致性套件。

## 三个被证据逼出来的决定

**1. 资源引用必须带作品前缀。** 实测：命名空间 b 的 `100101` 是角色乙，
命名空间 a的 `100100` 是角色甲——**同号不同人**。裸数字在系统里流动，迟早把
一个角色的档案配上另一个角色的模型，而且不报错。所以 `parseRef('100101')` 直接抛。

**2. 交叉表是数据，不是公式。** 看着有规律（charaId + 服装号 = 精灵 unit），
但 wiki 给 `1001` 登记的服装是 `03/04/50/53`，镜像里实际存在的是 `00/01/09`
——规律不成立。查不到就返回空，**绝不猜**：猜错的代价是显示了另一个角色，
而没人会立刻发现。

**3. 老库跑在 iframe 里，但调用方不知道。** cocos2d-html5 挂 `window.cc`，
Cubism Core 挂 `window.Live2DCubismCore`，同 realm 会互相覆盖。框架把 realm 隔离
藏进内核——`host.request(...)` 的写法与调用 inline 插件一模一样。

这三条在代码里是硬的，不是建议。完整清单见[守卫与铁律](/guide/guards)。

## 上游那 10 个仓库

框架**不装**它们的源码，也不装它们的资源。每个上游一份接线契约
（`contracts/*.source.json`）说明它如何成为插件，或明确不接入：

| 上游 | 接入方式 | 说明 |
|---|---|---|
| `example-model-viewer` | plugin（wrapper） | 上游两个类注入进来，上游一行未改 |
| `example-adv-live2d` | plugin（iframe） | Pixi 版本已 pin |
| `example-sprite-mirror` | plugin（iframe） | cocos2d-html5 的 `window.cc` |
| `example-live2d-viewer` | plugin（iframe） | 自带 live2d 运行时 |
| `example-search-site` | plugin（inline） | 纯 DOM 与图表 |
| `example-reader` | proxy | **未授予任何开源许可，不得 vendor**——它作为独立宿主装插件 |
| `example-client` | link | 客户端基线存档 |
| `example-restricted-data` | 🔴 none | 上游 CI 强制的公开部署禁令 |
| `example-user-archive` | 🔴 none | 190 名真实玩家的流量归档 |

最后两条**不进入任何公开面**，`pre-push` 钩子与 CI 守卫都会拦绕过尝试。

## 下一步

- [装上并跑起来](/guide/getting-started)
- [六个能力，怎么用](/guide/capabilities)
- [写一个插件](/PLUGIN-AUTHORING)
