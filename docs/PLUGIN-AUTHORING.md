# 写一个插件

一个插件 = 一份 manifest（我能做什么）+ 一个 `mount` 函数。
插件之间不互相 import；它们只通过 `PluginHost` 发意图、订阅事件。

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

## 四条规矩

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

## 支持就地更新

实现 `update(intent)` 后，同一插件的重复请求会走 update 而不是新开 surface。
不实现的话，连点五次「播放」会开出五个播放器，五个都在放音频。

## 测试

用无头宿主，在 node 上跑完整内核逻辑，不需要浏览器：

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

## 四个既有查看器的接入计划

| 仓库 | pluginId | 隔离 | 能力 | 备注 |
|---|---|---|---|---|
| example-model-viewer | `model-3d` | inline | `model3d.show` | three.js 是 ESM，可同 realm |
| example-adv-live2d | `adv-player` | iframe | `adv.play`、`live2d.show` | Pixi 版本已 pin，不能被打破 |
| example-sprite-mirror | `sprite-viewer` | iframe | `sprite.show` | cocos2d-html5 的 `window.cc` |
| example-live2d-viewer | `viewer-sp` | iframe | `live2d.show` | 自带 live2d 运行时 |
| example-search-site | `call-search` | inline | `search.query`、`chart.height` | 纯 DOM 与图表 |

逐条契约见 `contracts/*.source.json`。
