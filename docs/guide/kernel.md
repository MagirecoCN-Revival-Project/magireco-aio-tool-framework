# 内核：注册、派发、治理

`@aio/kernel` 是浏览器那一半。它管四件事：插件注册与意图派发、
surface 生命周期、WebGL 上下文治理、iframe RPC 桥。

（边缘那一半在 `@aio/site`，见[边缘半边](/guide/edge)。）

## 装一个内核

```ts
import { Kernel } from '@aio/kernel';

const kernel = new Kernel({
  resources,                 // ResourceProvider
  registry,                  // 可选，缺省是空表
  surfaces,                  // SurfaceProvider，见下
  governor: { maxLiveWebGL: 4 },
  logger: (level, pluginId, msg) => console[level]?.(`[${pluginId}] ${msg}`),
});

kernel.register(plugin);
await kernel.unregister('sprite-play');   // 会先关掉它开着的 surface
kernel.plugins;                            // 已注册的 id 列表
```

## 派发一个意图

```ts
kernel.can('sprite.show', ref);            // 有人能处理吗（同步，渲染路径上用）
kernel.providersFor('sprite.show', ref);   // 有哪几个能处理

const handle = await kernel.request({
  capability: 'sprite.show',
  ref,
  surface: 'inline',        // 'inline' | 'modal' | 'sheet' | 'dock'
  params: { movement: 'name_r' },
});
await handle?.close();
await kernel.closeAll();
```

::: tip 先 `can()` 再 `request()`
`request()` 在没有提供者时返回 `null` 而不抛错——**「这个能力没装」是正常状态，
不是异常**。UI 据此不画按钮，而不是画了按钮点下去报错。
:::

同一个能力有多个实现时，`request(intent, preferPlugin)` 的第二个参数指定用哪个。

## surface：宿主怎么给容器

```ts
interface SurfaceProvider {
  /** **必须同步**返回一个能挂载的容器（拿不到就返回 null） */
  acquire(surfaceId: string, hint: SurfaceHint, pluginId: string): SurfaceTarget | null;
  release(surfaceId: string): void;
}
```

`SurfaceTarget.container` 的类型是 `unknown`，约定写明**测试环境可为 null**。
插件的舞台工厂必须扛得住这一点：拿不到 DOM 就返回 `null`，引擎照常跑、
照常发 `progress`，只是不画。

测试里直接用无头实现，整套内核逻辑在 node 上跑完：

```ts
import { createHeadlessSurfaceProvider } from '@aio/plugin-sdk';

const surfaces = createHeadlessSurfaceProvider();
const kernel = new Kernel({ resources, surfaces });
surfaces.active;    // 当前活着的 surface，测试里拿它断言
```

### React 宿主的 surface 桥

内核的 `acquire()` 是**同步**的，必须当场返回容器；React 的渲染是异步的，
容器要等下一次 commit 才存在。`apps/station` 的解法：

1. `acquire()` 当场 `document.createElement` 造一个**游离**容器交给插件，插件立刻能画；
2. React 订阅 store（`useSyncExternalStore`），渲染各自的外框，用 ref 回调把这个
   游离节点 `append` 进去。

**React 永远不去重渲染那个节点的内容。** 这是必须的：three.js / cocos2d 直接
持有 DOM 与 WebGL 上下文，React 若把它们当受控内容重建，画面就没了。

换 Vue 或 Svelte 时要重写的只有那个 outlet 组件，`packages/` 一行都不用动。

## WebGL 上下文治理

浏览器同时保有的 WebGL 上下文有硬上限（常见 8–16）。超过之后**不会报错**，
只是最早那个上下文被丢弃：表现是「刚才还好好的 3D 查看器突然变黑」，
控制台安静得像什么都没发生。

这个问题在「一个页面一个查看器」的形态下不存在，但这套框架要让剧情、精灵、
Live2D、3D 同时活在一个页面上，就必须有人管。

策略是 **LRU 挂起**：超限时挂起最久没被碰过的实例。挂起 ≠ 关闭——状态还在，
用户再次交互时 `resume` 回来。

```ts
kernel.liveWebGLCount();     // 当前活着几个
await kernel.touch(surfaceId);   // 用户碰了它，刷新 LRU 时间戳
```

::: danger 占 WebGL 就要声明 `usesWebGL`
不声明的后果不是报错，是浏览器**静默丢弃**最早的上下文。声明了才会被纳入调度。

`suspend()` 里要**真的释放上下文**（`loseContext()` 或销毁 renderer），
只是暂停 RAF 不算数。
:::

生命周期方法（`suspend` / `resume` / `dispose`）会被治理器反复调用，
用户不感知，所以**必须幂等**。

## iframe 桥：老运行时关进自己的 realm

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

**关键是对调用方完全透明**：剧情阅读器发 `adv.play` 时不知道、也不需要知道
播放器跑在 iframe 里。这正是「插件化」与「iframe 拼站」的区别。

子帧只要实现五条命令（`mount` / `update` / `suspend` / `resume` / `dispose`），
每条回 `{t:'ok', id}` 或 `{t:'err', id, message}`；主动上报用
`{t:'progress'}` / `{t:'focus'}`。

协议逻辑不需要真浏览器就能测：

```ts
import { createMemoryTransportPair } from '@aio/kernel';
const [hostSide, frameSide] = createMemoryTransportPair();
```

::: warning `isolation: 'iframe'` 必须写 `isolation_reason`
守卫会拦。隔离有代价——一次 iframe 启动、一条 RPC——不写清为什么，
下一个人无从判断能不能改回 inline。
:::

## 事件总线

类型化，插件之间不 import：

```ts
const off = kernel.events.on('progress', ({ surfaceId, ref, position, total }) => { /* … */ });
off();
```

四种事件见[能力那一页](/guide/capabilities#回话-事件)。
监听器抛错不会打断其它监听器——`createEventBus(onListenerError)` 收得到。
