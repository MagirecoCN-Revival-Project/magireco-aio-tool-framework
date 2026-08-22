# 契约与一致性套件

这一层是「全新的系统」与「一堆适配器」的分界线。

适配器模型下，「换一个 3D 实现」意味着改宿主；系统模型下，它意味着换一个满足
同一份契约的包，宿主一行不动。**而这句话必须能被验证**，否则它只是愿望。

## 契约描述「能被怎么用」，不描述「怎么画」

```ts
export interface CapabilityContract {
  readonly id: CapabilityId;          // 'sprite.show'
  readonly title: string;
  readonly accepts: readonly RefKind[];      // 接受哪些 kind 的 ref
  readonly params: readonly CapabilityParamSpec[];
  readonly emits: readonly FrameworkEventName[];   // **必发**的事件
  readonly webglTypical: boolean;     // 参考值，不是断言（见下）
}
```

契约是数据，UI 可以读它来画表单、画入口：

```ts
import { CONTRACTS, contractOf } from '@aio/capability';

for (const c of CONTRACTS) {
  console.log(c.id, c.accepts, c.params.map((p) => p.name));
}
```

`@aio/capability` **不依赖任何实现**，也不被任何实现依赖着去做事——
它就是一张表。

## 一致性套件：不 import 任何具体实现

```ts
import { runCapabilityConformance } from '@aio/conformance';
import { SPRITE_SHOW } from '@aio/capability';
import { createSpritePlugin } from '@aio/plugin-sprite';

runCapabilityConformance({
  name: 'plugin-sprite（从零实现，无上游）',
  contract: SPRITE_SHOW,
  createPlugin: () => createSpritePlugin({ createStage: () => null }),
  createResources: () => new StaticProvider({ /* 含 present、不含 absent */ }),
  present: parseRef('a:sprite/100100/d_r'),
  absent: parseRef('a:sprite/999999/none'),
});
```

套件里只有契约、内核与接口。它验这些：

| 判据 | 为什么 |
|---|---|
| manifest 声明了这个能力，且能力标识合约定 | 不声明就派发不到 |
| `accepts` 覆盖契约要求的每个 kind | 少接一个，宿主按契约画出来的入口点下去没人处理 |
| 重复派发同一能力只保留一个实例 | 否则连点五次「播放」开出五个播放器，五个都在放音频 |
| 资源不在清单里时 `can()` 为假 | 不画按钮，而不是点了才 404 |
| 派发能挂载、能关闭 | — |
| 关闭之后不再发事件 | 用假时钟推 10 秒验；漏了就是关掉的播放器还在往总线上灌数据 |
| 容忍未知参数 | 调用方多传一个字段不该让实现挂掉 |

::: info `webglTypical` 是参考值，不是断言
套件曾经断言「实现的 `usesWebGL` 必须等于契约的 `webglTypical`」，
写第二个实现时当场发现那会把合法实现判成不合规——同一个 `adv.play`，
DOM 舞台不占 WebGL，Pixi/Cubism 舞台占。**这是实现属性，不是能力属性。**

契约里那个字段因此只是参考值，套件不拿它当判据。这一处是「先有能跑的实现，
契约才算被证伪过一次」的实例。
:::

## 它证明了什么

`packages/conformance/test/reference.test.ts` 里有**从零写、一行上游代码都不碰**
的参考实现，与真实现跑同一套判据。`model3d.show` 目前有三个实现同时全绿：

- `@aio/plugin-gltf`（自有，解析 glTF 2.0）
- `@aio/plugin-model-3d`（包装一个既有查看器，上游的类注入进来，上游一行未改）
- 参考实现（套件自带，用来证明契约可满足）

这就是「换一个实现宿主零改动」被验证的样子。

## 契约设计的三次订正

ADR 0002 有一句：**没有一个能跑的实现，契约一定设计错。** 这一轮应验了三次：

1. `live2d.show` 原本有 `costume` 参数 —— 写实现时发现一个 `model3.json` 描述的
   就是**一套**服装，换装等于换模型文件，那是另一条 ref。参数删掉。
2. `webglTypical` 原本是硬断言 —— 见上。
3. 一致性套件原本把 `container` 当 `HTMLElement` 用 —— 而契约写明「测试环境可为
   null」。13 处失败一次性暴露：**渲染是可选的，契约行为不是。**

所以流程是：契约与实现**一起落**，不先写契约。

## 谁有几个实现：`contracts/capabilities.json`

契约文件按上游仓库分（一个仓库一份），而「某能力有几个实现」是横着切的
——`sprite.show` 的两个候选分别躺在 `example-sprite-mirror.source.json` 与
`packages/plugin-sprite` 里，两份文件谁也看不出全貌。看不出全貌，
那条判据（少装一个模块宿主依然自洽）就没法查。

所以横着另记一份：

```json
{
  "capabilities": {
    "sprite.show": {
      "title": "显示战斗精灵",
      "default": "sprite-play",
      "implementations": [
        { "id": "sprite-play", "origin": "own",
          "package": "@aio/plugin-sprite", "isolation": "inline", "usesWebGL": false,
          "note": "从零实现：ExportJson 骨骼 + plist 图集解析…" },
        { "id": "sprite-viewer", "origin": "upstream",
          "source": "example-sprite-mirror", "isolation": "iframe", "usesWebGL": true,
          "note": "上游 cocos2d-html5 运行时…" }
      ]
    }
  }
}
```

`origin` 分三档不是分类癖，是**许可证边界**：

| origin | 意思 |
|---|---|
| `own` | 本仓库从零写，不依赖任何上游代码——这一档决定了「不碰上游也能用」是否成立 |
| `wrapper` | 本仓库的包，但运行时要把上游的类注入进来；上游一行未改 |
| `upstream` | 实现主体在上游仓库，本仓库目前只有契约，尚未接线 |

`tools/check-sources.py` 与竖着的契约**双向对账**，每条判据对应一种不报错的错：

- `default` 指向装不上的实现 → 宿主启动时才发现少一项能力；
- 实现 id 与上游 pluginId 或与包里 `manifest.id` 对不上 → 缺省的实现装上了却没人认得；
- 同一实现在两处属性不一致 → 两处说的是同一个 `PluginManifest`，只改一处就是让表自相矛盾；
- 实现指向 `publish=forbidden` 的源 → 能力表就是公开面的装配单；
- 上游契约声明了某能力却没登记进表 → 表立刻失真；
- 有契约却一个实现都没有 → ADR 0002 那条。

这张表第一次跑就查出了 `chart.height` 只有上游一个实现、且本仓库没有它的契约。
两边随后都补上了——这正是加这张表的理由。

## 新增一个能力的顺序

1. 在 `packages/capability/src/index.ts` 加一份契约，登进 `CONTRACTS`；
2. **同时**写一个能跑的实现（哪怕舞台是 `() => null`）；
3. 给它写一份 `runCapabilityConformance` 夹具；
4. 在 `contracts/capabilities.json` 登记；
5. `npm run check` —— 守卫会告诉你哪一步漏了。
