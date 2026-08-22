# magireco-aio-tool-framework

**一个把散落在 10 个仓库里的能力缝成一套系统的开源框架**，外加它的控制面。

📖 **文档站**：`npm run docs:dev` 本地看，或见 [部署与域名](docs/guide/deploy.md)。

不是把几个网站放进一个域名。判据只有一条：

> 模块之间**不互相 import、不知道对方存在**，却能互相调用并回话。
> 少装一个模块，宿主依然自洽，只是少一项能力。

看剧情时点一下，ADV 插件就地实机播放，并把行号回传给阅读器高亮；
看角色档案时点一下，精灵查看器（跑在自己的 iframe 里，因为 cocos2d 靠
`window.cc` 活着）就地显示——而档案页从未 import 过它。

```bash
npm install
npm run check                       # typecheck + 407 个测试 + 守卫
npm run -w @aio/station dev    # 带插件的 CMS 宿主，:3000
npm run docs:dev                    # 本文档站
```

## 现在能用什么

**六个能力，每一个都有从零写、一行上游代码都不碰的实现**：

| 能力 | 干什么 | 自有实现 |
|---|---|---|
| `sprite.show` | CocosStudio 骨骼 + plist 图集，父子变换合成，canvas2d 画真图 | `@aio/plugin-sprite` |
| `adv.play` | worksheet 解析（按表头名，不依赖列序）+ 时间轴 + 行号回流 | `@aio/plugin-adv` |
| `live2d.show` | Cubism `model3.json` + 动作/表情/口型同步会话 | `@aio/plugin-live2d` |
| `model3d.show` | glTF 2.0（动画清单、外部依赖、拒收 1.x 与 GLB） | `@aio/plugin-gltf` |
| `search.query` | 跨中/日/罗马字/假名/别名匹配，片假名折叠 | `@aio/plugin-search` |
| `chart.height` | 角色档案解析 + 与渲染无关的布局算术 | `@aio/plugin-chart` |

**`apps/station` 装着其中四个，一个占位都不剩。** 去 `/admin` 拔掉一个插件，
资料页上对应的按钮当场消失，其余功能一点没受影响——那条判据就是这么验的
（`apps/station/test/catalog.test.ts`）。

`model3d.show` 目前有**三个实现**同时过同一套一致性判据（自有的 glTF 解析、
包装 example-model-viewer 的适配器、以及套件自带的参考实现）。「换一个实现宿主零改动」
因此是能被验证的事，而不是靠读代码相信。

## 包

| 包 | 干什么 |
|---|---|
| `@aio/core` | 资源引用语法、能力/意图类型、事件总线。**零依赖** |
| `@aio/registry` | 实体交叉表：角色 ↔ 精灵 / Live2D / 3D / 语音 |
| `@aio/resource` | `ResourceProvider` 接口 + 两个实现：`ManifestCdnProvider`（清单、多源回退、https 强制、sha256）与 `StaticProvider`（离线包／本地目录）。一致性套件不 import 任何实现 |
| `@aio/kernel` | **浏览器半边**：插件注册、意图派发、surface 生命周期、WebGL 上下文治理、iframe RPC 桥 |
| `@aio/site` | **边缘半边**：路由、SSR 元信息、SEO、站点配置、下架 |
| `@aio/plugin-sdk` | `definePlugin` + 无头测试宿主 |
| `@aio/capability` | 能力契约：每个能力**能被怎么用**（接受的 kind、参数、必发的事件）。零依赖于任何实现 |
| `@aio/conformance` | 一致性套件。不 import 任何具体实现——「换一个实现宿主零改动」因此可验证 |
| `@aio/plugin-sprite` | `sprite.show`：骨骼与图集（plist）解析、父子变换合成、渲染无关的帧播放器，canvas2d 舞台按图集画真图 |
| `@aio/plugin-adv` | `adv.play`：worksheet 解析器 + 渲染无关的播放引擎，舞台注入 |
| `@aio/plugin-live2d` | `live2d.show`：Cubism `model3.json` 解析器 + 渲染无关的会话，舞台注入 |
| `@aio/plugin-gltf` | `model3d.show`：glTF 2.0 解析，舞台注入 |
| `@aio/plugin-search` | `search.query`：跨中/日/罗马字/假名/别名匹配，结果 ref 化 |
| `@aio/plugin-chart` | `chart.height`：角色档案解析 + 布局算术（量程、刻度、缺数据），DOM 舞台注入 |
| `@aio/plugin-model-3d` | `example-model-viewer` 的插件封装。上游那两个类**注入**进来，所以本仓库不依赖 three.js，判据也能在 node 上跑 |

除最后一个外全部**不碰上游**。包的 `main` 直接指向 TS 源码，没有构建产物
——它们要能被任何宿主直接 import。

## 三个设计决定，都是被证据逼出来的

**1. 资源引用必须带作品前缀。** 实测：命名空间 b 的 `100101` 是角色乙，
命名空间 a的 `100100` 是角色甲——**同号不同人**。裸数字在系统里流动，
迟早把一个角色的档案配上另一个角色的模型，而且不报错。所以
`parseRef('100101')` 直接抛错。

**2. 交叉表是数据，不是公式。** 看着有规律（charaId + 服装号 = 精灵 unit），
但 wiki 给 `1001` 登记的服装是 `03/04/50/53`，镜像里实际存在的是
`00/01/09`——规律不成立。查不到就返回空，**绝不猜**：猜错的代价是显示了
另一个角色，而没人会立刻发现。

**3. 老库跑在 iframe 里，但调用方不知道。** cocos2d-html5 挂 `window.cc`，
Cubism Core 挂 `window.Live2DCubismCore`，同 realm 会互相覆盖。框架把 realm
隔离藏进内核——`host.request(...)` 的写法与调用 inline 插件一模一样。

## 资源与网站分离

判据：**网站源码里 grep 不到任何资源路径。**

插件只说「给我这条 ref 的 texture」，剩下的（清单查表、按权重选路、失败冷却、
sha256 校验、下架降级）全在 `@aio/resource` 里。换 CDN、加备份源、
下架某批素材，都不需要动插件。

选路语义照抄 `example-client` 的 `CNMirrors`——那套被真实玩家验证过。

## 判据写成守卫，不靠自觉

```bash
python3 tools/check-sources.py          # 契约 + 能力表对账（六件事）
python3 tools/check-assets.py           # 版权素材不得入库（铁律 9）
python3 tools/test-check-sources.py     # 27 个坏样本必须全被拦下
```

一个拦不下任何东西的检查比没有检查更糟——它会让人以为有人在看着。
所以每加一条规则，就在自测里加一个会触发它的坏样本。
同一套判据另有一份跑在 CI 里，**不依赖任何本地配置**。

## 文档

完整文档由 `docs/` 构建成站（`npm run docs:dev`）。源文件：

```
docs/guide/                 上手、六个能力、三层、守卫、部署
docs/AIO-ARCHITECTURE.md    架构：三个概念、隔离、资源面、宿主模型
docs/CMS-ON-EDGEONE.md      CMS 形态：两半插件、静态导出与 KV 的矛盾、SEO、后台
docs/PLUGIN-AUTHORING.md    怎么写插件：从零实现（核心 + 注入舞台）或包装既有查看器
docs/AIO-ROADMAP.md         落地方案：七个阶段与验收判据
docs/CONSTRAINTS.md         硬约束：发布禁令、许可义务、平台限额
docs/adr/                   决策记录
docs/reports/               上游仓库盘点（不进文档站）
contracts/                  每个上游仓库如何成为插件（或明确不接入）
contracts/capabilities.json 横着记一遍：每个能力有几个实现、缺省装哪一个
tools/build-manifest.py     扫目录生成资源清单（不猜 ref，匹配不上就失败）
```

## 两条禁令

`example-restricted-data`（上游 CI 强制的公开部署禁令）与 `example-user-archive`
（190 名真实玩家的流量归档）**不进入任何公开面**。守卫会拦下绕过尝试，
自测里有对应的坏样本。

## 🔴 这里没有游戏素材

本仓库以 GPLv3 公开分发，而立绘、语音、BGM、模型、剧情文本的版权在
各自的版权方手里——我们没有任何权利去授予。所以**一个版权文件
都不进这棵树**：它会让整份 GPLv3 分发变成一个我们无权做出的授权声明，而且
**git 历史不可逆**——删掉它只让当前 HEAD 干净，历史里那份仍在被分发。

素材的去处是资源面（COS + EdgeOne CDN），经 `@aio/resource` 的清单按 ref 取用。

## 许可

本仓库 **GPLv3**（见 `LICENSE`）。上游各仓库的许可各归各的，逐条登记在
`docs/CONSTRAINTS.md`。特别地：`example-reader` 未授予任何开源许可，
**不得 vendor**——它作为独立宿主安装插件，主权不变，能力增加。
