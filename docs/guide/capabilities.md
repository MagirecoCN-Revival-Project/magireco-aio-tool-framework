# 六个能力，怎么用

能力是**用途**，不是实现。调用方说「给这条 ref 来个 `sprite.show`」，
谁来做、用 canvas 还是 cocos2d、跑在 inline 还是 iframe，它一概不知道。

```ts
import { parseRef } from '@aio/core';

const ref = parseRef('a:sprite/100100/d_r');

// 先问：有人能处理吗？没有就别画按钮。
if (kernel.can('sprite.show', ref)) {
  const handle = await kernel.request({
    capability: 'sprite.show',
    ref,
    surface: 'inline',
    params: { movement: 'name_r' },
  });
  // handle 为 null 表示没有提供者——这是正常状态，不是异常
  await handle?.close();
}
```

## 总览

| 能力 | 接受的 kind | 参数 | 会发的事件 | 自有实现 |
|---|---|---|---|---|
| `model3d.show` | `model3d` | `animation` | — | `@aio/plugin-gltf` |
| `sprite.show` | `sprite` | `variant` `movement` `paused` | `progress` | `@aio/plugin-sprite` |
| `live2d.show` | `live2d` | `motion` `expression` `lipSync` | `entity.focused` | `@aio/plugin-live2d` |
| `adv.play` | `scenario` | `line` `auto` | `progress` `entity.focused` | `@aio/plugin-adv` |
| `search.query` | `character` | `q` | `entity.focused` | `@aio/plugin-search` |
| `chart.height` | `character` | `compare` | `entity.focused` | `@aio/plugin-chart` |

契约本身在 `@aio/capability`，是**数据**，可以读：

```ts
import { CONTRACTS, contractOf, SPRITE_SHOW } from '@aio/capability';

contractOf('sprite.show')?.params;   // 参数表，UI 可以据此画表单
SPRITE_SHOW.emits;                   // ['progress']
```

::: tip 未知参数必须被容忍
契约里有一条：实现**不能因为多收了一个不认识的参数就挂掉**。
所以调用方多传一个字段是安全的，一致性套件里有一条专门验它。
:::

## `sprite.show` —— 战斗精灵

```ts
await kernel.request({
  capability: 'sprite.show',
  ref: parseRef('a:sprite/100100/d_r'),
  params: { movement: 'action_in', paused: false },
});
```

`@aio/plugin-sprite` 解析 CocosStudio 的 `ExportJson`（骨骼、动作、关键帧）
与 `plist` 图集，把父子变换合成为世界变换，再交给注入的舞台去画。

- **动作名一律来自数据**（实测样本是 `name_r` / `action_in` / `outAnim` 之类），
  绝不按命名规律推断。`movement` 传了个不存在的名字 → 记一条 warn，
  用默认动作，而不是崩。
- 有图集与贴图时画真图；没有时退回画骨骼方块——那条路是资源面上线前唯一能跑的。
- 每帧发 `progress`（`position` = 帧号，`total` = 帧长）。

单独用解析器也行，它不依赖内核：

```ts
import { parseArmature, parseAtlas, worldPoseAt } from '@aio/plugin-sprite';

const doc = parseArmature(JSON.parse(exportJsonText));
doc.movements.map((m) => m.name);            // 有哪些动作，来自数据
const bones = worldPoseAt(doc, doc.movements[0]!, 12);   // 第 12 帧的世界姿态
```

## `adv.play` —— 实机播放剧情

```ts
await kernel.request({
  capability: 'adv.play',
  ref: parseRef('a:scenario/310241@zh'),
  params: { line: 0, auto: true },
});

kernel.events.on('progress', (p) => {
  // 阅读器据此高亮当前行——而它从未 import 过播放器
});
```

worksheet 解析器**按表头名建索引，不依赖列序**：`ActionType` / `Name` /
`Comment` / `AssetID` 换个顺序照样认得，注释行跳过，未知列原样留在 `extra` 里。
缺 `ActionType` 直接拒收——那一列决定这一行是什么，猜不得。

## `live2d.show` —— Cubism

```ts
await kernel.request({
  capability: 'live2d.show',
  ref: parseRef('a:live2d/1001/costume03'),
  params: { motion: 'idle', lipSync: true },
});
```

::: warning 换装是换 ref，不是换参数
契约里原本有个 `costume` 参数，写实现时发现它是错的：一个 `model3.json` 描述的
就是**一套**服装（Moc、贴图、动作、表情全绑在一起），换装等于换一个模型文件。
留着它会诱使实现假装能就地换装，而它实际上必须重新加载。
服装是 ref 的一段，由清单与交叉表决定。
:::

`setLipSync()` 在模型没登记 LipSync 参数时返回 `false` 而不是假装打开了。

## `model3d.show` —— glTF

```ts
await kernel.request({
  capability: 'model3d.show',
  ref: parseRef('b:model3d/100101'),
  params: { animation: 'idle' },
});
```

`@aio/plugin-gltf` 解析 glTF 2.0：动画清单、场景节点、外部依赖。
拒收 1.x 与 GLB（两者的结构不同，按 2.0 去读会读出错的东西）；
`data:` URI 不算外部依赖；无名动画按 `#下标` 显式指代，不给它编个名字。

这个能力有**三个实现**同时过同一套判据——`plugin-gltf`（自有）、
`plugin-model-3d`（包装一个既有查看器，上游一行未改）、以及一致性套件里那个
从零写的参考实现。「换一个实现宿主零改动」就是这么被验证的。

## `search.query` —— 检索

```ts
await kernel.request({
  capability: 'search.query',
  ref: parseRef('a:character/1001'),
  params: { q: '角色甲' },
});
```

跨中文 / 日文 / 罗马字 / 别名匹配，片假名折叠成平假名。空查询返回空
（不是返回全部）。

::: info 语料条目的 ref 是可选的
实测发现上游的角色目录**没有任何 ID**，按显示名索引，而显示名跨源还对不上
（「角色甲（另一种译名）」vs「角色甲」）。所以条目的 `ref` 可有可无，没有就不发
`entity.focused`——**绝不按名字凑一个 ref 出来**。
:::

## `chart.height` —— 身高对比

```ts
await kernel.request({
  capability: 'chart.height',
  ref: parseRef('a:character/1001'),
  params: { compare: 'b:character/100101,a:character/1002' },
});
```

档案走资源面的 `profile` role（JSON，字段是 `heightCm` 而不是 `height`
——`150` 到底是厘米还是寸，数据方与读取方各猜一次就会错，而错了不报错）。

三条不报错的错在这里被堵住：

- 没登记身高 → `heightCm` 是 `null`，**不画柱子也不当成 0**，但列进 `missing`
  并在图下方说出来（悄悄消失会让人以为那个角色不在名单里）；
- 量程缺省从 0 起——截断纵轴会让 155 与 160 看起来差一倍；
- `compare` 里拆不出来的 ref 丢掉而不是抛，但**裸 ID 依然拒绝**：
  补一个前缀就是把一个角色的身高配到另一个角色头上。

## 回话：事件

四种事件，类型化，插件之间不 import：

| 事件 | 什么时候 |
|---|---|
| `surface.opened` / `surface.closed` | 某个 surface 上的插件开始／结束呈现某个资源 |
| `progress` | 播放浏览进度。`position` 的含义由 kind 决定（剧情=行号，精灵=帧号） |
| `entity.focused` | 用户在某个插件里选中了另一个实体（ADV 里点了立绘、图上点了一根柱子） |
| `resource.failed` | 资源加载失败，宿主统一提示与降级 |

```ts
const off = kernel.events.on('entity.focused', ({ ref }) => {
  if (kernel.can('codex.open', ref)) void kernel.request({ capability: 'codex.open', ref });
});
off();   // on() 返回取消订阅函数
```

**只能打开、不能回话的东西是跳转链接，不是插件。**
契约的 `emits` 记的就是这条。
