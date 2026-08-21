# 写一个插件

一个插件 = 一份 manifest（我能做什么）+ 一个 `mount` 函数。
插件之间不互相 import；它们只通过 `PluginHost` 发意图、订阅事件。

## 先决定：从零写，还是包装既有查看器

这份文档原本只讲后者。**ADR 0002 之后主路径是前者**，理由不是技术偏好：

> 这是开源仓库，直接去改上游第一不合适、第二容易牵出许可证问题。

`example-reader` 未授予任何开源许可，`example-live2d-viewer` 是他人仓库。所以
「把上游改一改接进来」不能是这套系统能不能成立的前提。现在五个能力
（`model3d.show` / `sprite.show` / `live2d.show` / `adv.play` / `search.query`）
各有一个**不碰任何上游代码**的实现；上游若愿意接，它是同一契约的又一个实现。

谁有几个实现，横着记在 [`contracts/capabilities.json`](../contracts/capabilities.json)，
`tools/check-sources.py` 会与各仓库的竖表对账。**新插件要在那里登记**，
否则守卫会红——一张对不上账的表比没有表更糟。

| origin | 意思 | 例子 |
|---|---|---|
| `own` | 本仓库从零写，不依赖任何上游代码 | `@aio/plugin-sprite` |
| `wrapper` | 本仓库的包，运行时把上游的类注入进来，上游一行未改 | `@aio/plugin-model-3d` |
| `upstream` | 实现主体在上游仓库，本仓库目前只有契约 | `sprite-viewer`（cocos2d） |

## 最小插件

```ts
import { definePlugin } from '@aio/plugin-sdk';

export const voicePlayer = definePlugin({
  manifest: {
    id: 'voice-player',
    version: '0.1.0',
    title: '语音播放',
    isolation: 'inline',
    provides: [{ id: 'voice.play', accepts: ['voice'], title: '播放语音' }],
  },
  async mount(target, intent, host) {
    const buf = await host.resources.fetchPart(intent.ref, 'audio');
    const ctx = new AudioContext();
    const src = ctx.createBufferSource();
    src.buffer = await ctx.decodeAudioData(buf);
    src.connect(ctx.destination);
    src.start();

    return {
      suspend: () => ctx.suspend(),
      resume: () => ctx.resume(),
      dispose: () => { src.stop(); void ctx.close(); },
    };
  },
});
```

注册后，**任何**模块都能播语音，而不需要知道这个插件存在：

```ts
if (host.can('voice.play', voiceRef)) { /* 画按钮 */ }
```

## 从零写：核心与舞台分开

现有五个实现是同一个切法，值得照抄：

```
解析器      把资源字节变成一份归一化的数据（纯函数，零 DOM）
引擎/播放器  管状态与回话（推帧、选动作、暂停、释放），画面交给注入的 Stage
Stage       真正把东西画出来的那一层，由**调用方注入**
```

```ts
export interface Stage {
  drawFrame(movement: SpriteMovement, frame: number): void;
  dispose(): void;
}

export function createSpritePlugin(deps: {
  createStage(container: unknown): Stage | null;
  readonly usesWebGL?: boolean;
}): Plugin { /* … */ }
```

三件事因此成立：

1. **整套逻辑能在 node 上逐条验**——解析、选动作、循环、进度回流都不需要
   浏览器，更不需要 GPU。`npm test` 跑的就是这些。
2. **上游查看器接进来时是 `Stage` 的又一个实现**，不是我们必须去改的东西。
   `example-sprite-mirror` 那 367 个 cocos2d 引擎文件与 4,025 组素材可以留在原地。
3. **`usesWebGL` 由舞台决定，不由能力决定**（见下）。

`createStage` 拿不到 DOM 时返回 `null`，播放器照常推帧、照常发 `progress`，
只是不画。这不是凑合：一致性套件就在这条路上跑。

## 五条规矩

### 1. 生命周期方法必须幂等

`suspend` / `resume` / `dispose` 会被上下文治理器反复调用，用户不感知。
重复调一次不能出错。

### 2. 占 WebGL 就要声明

```ts
manifest: { usesWebGL: true, ... }
```

不声明的后果不是报错，是**浏览器静默丢弃最早的上下文**——某个已经打开的
查看器突然变黑，控制台什么都没有。声明了才会被治理器纳入 LRU 调度。

`suspend()` 里要真的释放上下文（`loseContext()` 或销毁 renderer），
只是暂停 RAF 不算数。

> **这是实现属性，不是能力属性。** 能力契约里那个字段叫 `webglTypical`，
> 是参考值：同一个 `adv.play`，DOM 舞台不占 WebGL，Pixi/Cubism 舞台占。
> 一致性套件曾断言「实现必须与契约相等」，写第二个实现时当场发现那会把
> 合法实现判成不合规——已经改掉了。

### 3. 靠全局变量活着的运行时用 `iframe`

cocos2d-html5 挂 `window.cc`，Cubism Core 挂 `window.Live2DCubismCore`。
这类库同 realm 装两份会互相覆盖。

```ts
import { createIframePlugin } from '@aio/kernel';

export const spriteViewer = createIframePlugin({
  manifest: { id: 'sprite-viewer', isolation: 'iframe', usesWebGL: true, /* … */ },
  async connect(target) {
    const frame = document.createElement('iframe');
    frame.src = '/frames/sprite/';
    (target.container as HTMLElement).append(frame);
    await frameReady(frame);
    return messagePortTransport(frame);
  },
});
```

子帧只要实现五条命令（`mount` / `update` / `suspend` / `resume` / `dispose`），
每条回 `{t:'ok', id}` 或 `{t:'err', id, message}`；主动上报用
`{t:'progress'}` / `{t:'focus'}`。

**契约要求写 `isolation_reason`**（守卫会拦）。隔离有代价——一次 iframe 启动、
一条 RPC——不写清为什么，下一个人无从判断能不能改回 inline。

### 4. 资源只走 `host.resources`

```ts
// ✅
const buf = await host.resources.fetchPart(ref, 'texture');

// ❌ 直接拼路径——换 CDN、下架、多源回退全部失效
const buf = await fetch(`https://assets.example/sprite/${id}.png`);
```

判据：**插件源码里 grep 不到任何 host 名或资源路径。**

这条的上游是铁律 9：URL 后面的东西（立绘、语音、模型、剧情文本）版权不在我们
手里，一个字节都不进这棵树。插件不碰 URL，正是因为那些文件不属于我们。

### 5. 解析不到就抛，查不到就返回 null——不猜

```ts
// ✅ 查不到动作就抛，列出这份骨骼里真正有的
throw new SpritePlayerError(`没有动作 ${name}——这份骨骼里有：${list.join('、')}`);

// ❌ 退回第一个动作
return doc.movements[0];
```

猜错的代价不是崩溃，是**显示了另一个东西且不报错**：另一段动作、另一个角色的
模型、大图里隔壁那张贴图。铁律 1、2 是同一条判断的两个实例，写实现时会反复
撞上它——`parseArmature` 的 `dr`、图集的 `metadata.format`、交叉表的查不到，
处理方式都一样。

## 发意图给别人

插件也是调用方。ADV 里点了立绘要打开角色档案：

```ts
const owner = host.registry.ownerOf(spriteRef);   // 反查主人
if (owner !== null && host.can('codex.open', owner)) {
  await host.request({ capability: 'codex.open', ref: owner });
}
```

**先 `can()` 再 `request()`**。`request()` 在没有提供者时返回 `null` 而不抛错——
「这个能力没装」是正常状态，不是异常。

## 回话

```ts
host.events.emit('progress', {
  surfaceId: host.surfaceId,
  ref: intent.ref,
  position: currentLine,
  total: totalLines,
});
```

订阅方自己过滤 ref。这是「剧情阅读器跟着 ADV 高亮」的唯一通道。
**只能打开、不能回话的东西是跳转链接，不是插件**——契约的 `emits` 记的就是这个。

## 支持就地更新

实现 `update(intent)` 后，同一插件的重复请求会走 update 而不是新开 surface。
不实现的话，连点五次「播放」会开出五个播放器，五个都在放音频。
一致性套件里有一条专门验它。

## 测试

### 无头宿主：在 node 上跑完整内核逻辑

```ts
import { Kernel } from '@aio/kernel';
import { createHeadlessSurfaceProvider } from '@aio/plugin-sdk';

const kernel = new Kernel({
  resources, registry,
  surfaces: createHeadlessSurfaceProvider(),
});
kernel.register(myPlugin);
expect(kernel.can('voice.play', ref)).toBe(true);
```

iframe 插件用 `createMemoryTransportPair()` 模拟子帧，协议逻辑照样能测。

### 一致性套件：证明「我是这个能力的一个合格实现」

```ts
import { runCapabilityConformance } from '@aio/conformance';
import { SPRITE_SHOW } from '@aio/capability';

runCapabilityConformance({
  name: '@aio/plugin-sprite',
  contract: SPRITE_SHOW,
  createPlugin: () => createSpritePlugin({ createStage: () => null }),
  createResources,
  present: parseRef('a:sprite/100100/d_r'),
  absent: parseRef('a:sprite/999999/none'),
});
```

套件**不 import 任何具体实现**，只有契约、内核与接口。所以
「换一个实现宿主零改动」是能被验证的事，而不是靠读代码相信。
它验的是能力契约那一半——accepts 覆盖、重复派发只留一个实例、
资源不在清单时 `can()` 为假、关闭之后不再发事件、容忍未知参数。

需要 GPU 才能验的（画得对不对）**不属于契约**：契约管的是「能被怎么用」，
不是「画成什么样」。

## 既有查看器的接线状态

| 仓库 | pluginId | 隔离 | 能力 | 状态 |
|---|---|---|---|---|
| example-model-viewer | `model-3d` | inline | `model3d.show` | `wrapper` 已写好，上游一行未改；等 `upstream-three-subpackage` 可安装 |
| example-adv-live2d | `adv-player` | iframe | `adv.play`、`live2d.show` | 契约已写，尚未接线。Pixi 版本已 pin，不能被打破 |
| example-sprite-mirror | `sprite-viewer` | iframe | `sprite.show` | 契约已写，尚未接线。cocos2d-html5 的 `window.cc` |
| example-live2d-viewer | `viewer-sp` | iframe | `live2d.show` | 契约已写，尚未接线。自带 live2d 运行时 |
| example-search-site | `call-search` | inline | `search.query`、`chart.height` | 契约已写，尚未接线。`chart.height` 目前只有它一个实现 |

上面每一项都**已经有一个 `own` 实现在跑**（`chart.height` 除外），所以接线是
「多一个可选实现」，不是「缺了就不能用」。逐条契约见 `contracts/*.source.json`，
全貌见 `contracts/capabilities.json`。
