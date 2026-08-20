import type {
  Capability,
  CapabilityId,
  EventBus,
  Intent,
  RefKind,
  ResourceRef,
  SurfaceHint,
} from '@aio/core';
import type { Registry } from '@aio/registry';
import type { ResourceProvider } from '@aio/resource';

/**
 * 插件契约。
 *
 * 一个插件 = 一组**能力**（我能对哪些 ref 做什么）+ 一个挂载函数。
 * 插件之间不互相 import，也不互相知道对方存在；它们只通过 `PluginHost`
 * 发意图、订阅事件。
 */

/** 插件跑在哪种隔离级别。 */
export type Isolation =
  /**
   * 同一个 realm，ES 模块作用域隔离。适用于不污染全局的现代库
   * （three.js、Pixi 都是 ESM，互不干扰）。
   */
  | 'inline'
  /**
   * 独立 iframe + postMessage RPC。**给依赖全局变量的老库用**——
   * cocos2d-html5 挂 `window.cc`，Cubism Core 挂 `window.Live2DCubismCore`，
   * 两个这样的插件同处一个 realm 会互相覆盖。
   *
   * 关键：对调用方**完全透明**。剧情阅读器发 `adv.play` 时不知道、也不需要知道
   * 播放器跑在 iframe 里——这正是「插件化」与「iframe 拼站」的区别。
   */
  | 'iframe';

export interface PluginManifest {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly provides: readonly Capability[];
  readonly isolation: Isolation;
  /**
   * 会占用 WebGL 上下文。浏览器同时活着的上下文数量有上限（常见 8–16），
   * 超了会静默丢弃最老的那个——表现是某个已经打开的查看器突然变黑而不报错。
   * 声明了这一项的插件由内核的上下文治理器统一调度。
   */
  readonly usesWebGL?: boolean;
  /** 声明依赖的资源 kind，供宿主预检清单是否齐备。 */
  readonly needs?: readonly RefKind[];
}

/** 内核交给插件的把手。插件能做的事，全在这里。 */
export interface PluginHost {
  readonly resources: ResourceProvider;
  readonly registry: Registry;
  readonly events: EventBus;
  /** 这个实例挂在哪个 surface 上。发事件时要带。 */
  readonly surfaceId: string;
  /**
   * 发一个意图。**插件也能发**——ADV 播放时点了角色立绘，
   * 它就发 `codex.open`，而不需要知道谁在处理。
   * 没有提供者时返回 null，调用方据此不渲染入口。
   */
  request(intent: Intent): Promise<SurfaceHandle | null>;
  /** 有没有人能处理这个意图。UI 用它决定按钮画不画。 */
  can(capability: CapabilityId, ref: ResourceRef): boolean;
  readonly log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void;
}

/** 挂载目标。inline 插件拿到 DOM 容器；iframe 插件拿到的是宿主准备的 iframe。 */
export interface SurfaceTarget {
  readonly surfaceId: string;
  /** 浏览器环境下是 HTMLElement；测试环境可为 null。 */
  readonly container: unknown;
  readonly hint: SurfaceHint;
}

/** 插件实例的生命周期。**四个方法都必须幂等**——治理器会反复调。 */
export interface PluginInstance {
  /**
   * 让出资源但保留状态：释放 WebGL 上下文、暂停 RAF 与音频。
   * 被上下文治理器调用，用户不感知。
   */
  suspend(): void | Promise<void>;
  resume(): void | Promise<void>;
  dispose(): void | Promise<void>;
  /** 同一个 surface 上换个资源，比 dispose+mount 省一次初始化。 */
  update?(intent: Intent): void | Promise<void>;
}

export interface Plugin {
  readonly manifest: PluginManifest;
  mount(target: SurfaceTarget, intent: Intent, host: PluginHost): Promise<PluginInstance>;
}

export interface SurfaceHandle {
  readonly surfaceId: string;
  readonly pluginId: string;
  readonly ref: ResourceRef;
  close(): Promise<void>;
  update(intent: Intent): Promise<void>;
}
