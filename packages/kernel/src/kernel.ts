import {
  capabilityAccepts,
  createEventBus,
  formatRef,
  isValidCapabilityId,
  type CapabilityId,
  type EventBus,
  type Intent,
  type ResourceRef,
  type SurfaceHint,
} from '@aio/core';
import { Registry } from '@aio/registry';
import type { ResourceProvider } from '@aio/resource';
import { ContextGovernor, type GovernorOptions } from './governor.js';
import type { Plugin, PluginHost, PluginInstance, SurfaceHandle, SurfaceTarget } from './types.js';

export class KernelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KernelError';
  }
}

export interface SurfaceProvider {
  /** 宿主给出一个挂载点。返回 null 表示当前拒绝开新 surface（如已满屏）。 */
  acquire(surfaceId: string, hint: SurfaceHint, pluginId: string): SurfaceTarget | null;
  release(surfaceId: string): void;
}

export interface KernelOptions {
  readonly resources: ResourceProvider;
  readonly registry?: Registry;
  readonly surfaces: SurfaceProvider;
  readonly governor?: GovernorOptions;
  readonly logger?: (level: string, pluginId: string, msg: string) => void;
}

interface LiveSurface {
  readonly surfaceId: string;
  readonly plugin: Plugin;
  readonly instance: PluginInstance;
  ref: ResourceRef;
}

export class Kernel {
  readonly events: EventBus;
  readonly resources: ResourceProvider;
  readonly registry: Registry;

  readonly #plugins = new Map<string, Plugin>();
  readonly #byCapability = new Map<CapabilityId, Plugin[]>();
  readonly #surfaces = new Map<string, LiveSurface>();
  readonly #governor: ContextGovernor;
  readonly #surfaceProvider: SurfaceProvider;
  readonly #logger: (level: string, pluginId: string, msg: string) => void;
  #seq = 0;

  constructor(options: KernelOptions) {
    this.resources = options.resources;
    this.registry = options.registry ?? Registry.empty();
    this.#surfaceProvider = options.surfaces;
    this.#governor = new ContextGovernor(options.governor ?? {});
    this.#logger = options.logger ?? (() => {});
    this.events = createEventBus((err) => {
      this.#logger('error', '(kernel)', `事件监听器抛错：${String(err)}`);
    });
  }

  // ---- 插件注册 --------------------------------------------------------

  register(plugin: Plugin): void {
    const { id, provides } = plugin.manifest;
    if (this.#plugins.has(id)) {
      throw new KernelError(`插件 ${id} 重复注册`);
    }
    if (provides.length === 0) {
      // 不提供任何能力的插件对系统而言不存在。与其让它静默常驻，不如拦下——
      // 多半是 manifest 写漏了。
      throw new KernelError(`插件 ${id} 没有声明任何能力`);
    }
    for (const cap of provides) {
      if (!isValidCapabilityId(cap.id)) {
        throw new KernelError(`插件 ${id} 的能力标识 ${JSON.stringify(cap.id)} 不合约定（<域>.<动词>）`);
      }
      if (cap.accepts.length === 0) {
        throw new KernelError(`插件 ${id} 的能力 ${cap.id} 没声明接受任何 ref kind`);
      }
    }

    this.#plugins.set(id, plugin);
    for (const cap of provides) {
      const list = this.#byCapability.get(cap.id) ?? [];
      list.push(plugin);
      // 高 priority 在前；同分按 id 稳定排序，避免注册顺序影响结果。
      list.sort((a, b) => priorityOf(b, cap.id) - priorityOf(a, cap.id)
        || a.manifest.id.localeCompare(b.manifest.id));
      this.#byCapability.set(cap.id, list);
    }
  }

  /**
   * 卸载插件：关掉它开着的所有 surface，从能力表里摘掉。
   *
   * 插件系统装得上却卸不掉是不完整的——宿主要支持「关掉某个能力」
   * （用户偏好、A/B、故障隔离），而卸载之后 `can()` 必须立刻返回 false，
   * 依赖它的按钮随之消失。这正是插件化与硬编码集成的分界。
   */
  async unregister(pluginId: string): Promise<void> {
    const plugin = this.#plugins.get(pluginId);
    if (plugin === undefined) return;

    for (const [surfaceId, live] of [...this.#surfaces]) {
      if (live.plugin.manifest.id === pluginId) {
        await this.close(surfaceId);
      }
    }

    this.#plugins.delete(pluginId);
    for (const [cap, list] of [...this.#byCapability]) {
      const next = list.filter((p) => p.manifest.id !== pluginId);
      if (next.length === 0) this.#byCapability.delete(cap);
      else this.#byCapability.set(cap, next);
    }
  }

  get plugins(): readonly string[] {
    return [...this.#plugins.keys()];
  }

  // ---- 能力查询 --------------------------------------------------------

  /**
   * 有没有插件能处理这个意图。
   *
   * **这是整个框架最常被调用的方法**：每个「点这里播放 / 点这里看模型」的
   * 按钮渲染前都要问一次。没装对应插件就不画按钮，宿主依然自洽。
   */
  can(capability: CapabilityId, ref: ResourceRef): boolean {
    return this.#candidates(capability, ref).length > 0;
  }

  /** 谁能处理，按优先级排序。用于「用哪个打开」这类选择界面。 */
  providersFor(capability: CapabilityId, ref: ResourceRef): readonly string[] {
    return this.#candidates(capability, ref).map((p) => p.manifest.id);
  }

  #candidates(capability: CapabilityId, ref: ResourceRef): readonly Plugin[] {
    const list = this.#byCapability.get(capability) ?? [];
    return list.filter((p) => {
      const cap = p.manifest.provides.find((c) => c.id === capability);
      if (cap === undefined || !capabilityAccepts(cap, ref.kind)) return false;
      // 资源清单里没有的东西，插件再能干也打不开。在这里挡掉，
      // 按钮就不会画出来，用户点了才发现 404 的情况不复存在。
      return this.resources.has(ref);
    });
  }

  // ---- 意图派发 --------------------------------------------------------

  /**
   * 处理一个意图：找插件 → 要 surface → 挂载。
   *
   * 没有提供者返回 null（不是抛错）——「这个能力没装」是正常状态，
   * 不是异常。调用方本就应该先用 `can()` 问过。
   */
  async request(intent: Intent, preferPlugin?: string): Promise<SurfaceHandle | null> {
    const candidates = this.#candidates(intent.capability, intent.ref);
    const plugin =
      preferPlugin === undefined
        ? candidates[0]
        : candidates.find((p) => p.manifest.id === preferPlugin);
    if (plugin === undefined) return null;

    // 同一个插件已经在某个 surface 上开着同类资源 → 就地 update，不新开。
    // 否则连点五次「播放」会开出五个 ADV 播放器，五个都在放音频。
    const existing = [...this.#surfaces.values()].find(
      (s) => s.plugin.manifest.id === plugin.manifest.id,
    );
    if (existing !== undefined && existing.instance.update !== undefined) {
      await existing.instance.update(intent);
      existing.ref = intent.ref;
      this.#governor.touch(existing.surfaceId);
      await this.#enforceBudget();
      this.events.emit('surface.opened', {
        surfaceId: existing.surfaceId,
        pluginId: plugin.manifest.id,
        ref: intent.ref,
      });
      return this.#handleFor(existing);
    }

    const surfaceId = `sf-${++this.#seq}`;
    const target = this.#surfaceProvider.acquire(
      surfaceId,
      intent.surface ?? 'modal',
      plugin.manifest.id,
    );
    if (target === null) {
      this.#logger('warn', plugin.manifest.id, `宿主拒绝为 ${formatRef(intent.ref)} 分配 surface`);
      return null;
    }

    const host = this.#hostFor(surfaceId, plugin.manifest.id);
    let instance: PluginInstance;
    try {
      instance = await plugin.mount(target, intent, host);
    } catch (err) {
      // 挂载失败要把 surface 还回去，否则宿主那边会留一个空壳容器，
      // 而且 surfaceId 永远不会被 release。
      this.#surfaceProvider.release(surfaceId);
      throw new KernelError(
        `插件 ${plugin.manifest.id} 挂载 ${formatRef(intent.ref)} 失败：` +
          (err instanceof Error ? err.message : String(err)),
      );
    }

    const live: LiveSurface = { surfaceId, plugin, instance, ref: intent.ref };
    this.#surfaces.set(surfaceId, live);
    this.#governor.register(surfaceId, plugin.manifest.usesWebGL === true);
    await this.#enforceBudget();

    this.events.emit('surface.opened', {
      surfaceId,
      pluginId: plugin.manifest.id,
      ref: intent.ref,
    });
    return this.#handleFor(live);
  }

  #handleFor(live: LiveSurface): SurfaceHandle {
    return {
      surfaceId: live.surfaceId,
      pluginId: live.plugin.manifest.id,
      get ref() {
        return live.ref;
      },
      close: async () => {
        await this.close(live.surfaceId);
      },
      update: async (next: Intent) => {
        if (live.instance.update === undefined) {
          throw new KernelError(`插件 ${live.plugin.manifest.id} 不支持就地更新`);
        }
        await live.instance.update(next);
        live.ref = next.ref;
        this.#governor.touch(live.surfaceId);
      },
    };
  }

  #hostFor(surfaceId: string, pluginId: string): PluginHost {
    return {
      resources: this.resources,
      registry: this.registry,
      events: this.events,
      surfaceId,
      request: (intent) => this.request({ ...intent, source: pluginId }),
      can: (capability, ref) => this.can(capability, ref),
      log: (level, msg) => this.#logger(level, pluginId, msg),
    };
  }

  // ---- surface 生命周期 -------------------------------------------------

  async close(surfaceId: string): Promise<void> {
    const live = this.#surfaces.get(surfaceId);
    if (live === undefined) return;
    this.#surfaces.delete(surfaceId);
    this.#governor.unregister(surfaceId);
    try {
      await live.instance.dispose();
    } finally {
      // 插件 dispose 抛错也必须归还 surface。否则一个坏插件能让宿主
      // 永久漏掉一个容器，多点几次就把界面塞满。
      this.#surfaceProvider.release(surfaceId);
      this.events.emit('surface.closed', { surfaceId, pluginId: live.plugin.manifest.id });
    }
  }

  async closeAll(): Promise<void> {
    for (const id of [...this.#surfaces.keys()]) {
      await this.close(id);
    }
  }

  /** 用户碰了某个 surface：刷新 LRU 并在需要时恢复。 */
  async touch(surfaceId: string): Promise<void> {
    const live = this.#surfaces.get(surfaceId);
    if (live === undefined) return;
    await live.instance.resume();
    this.#governor.markSuspended(surfaceId, false);
    this.#governor.touch(surfaceId);
    await this.#enforceBudget();
  }

  async #enforceBudget(): Promise<void> {
    for (const surfaceId of this.#governor.overBudget()) {
      const live = this.#surfaces.get(surfaceId);
      if (live === undefined) continue;
      await live.instance.suspend();
      this.#governor.markSuspended(surfaceId, true);
      this.#logger('debug', live.plugin.manifest.id, `${surfaceId} 因 WebGL 上下文超额被挂起`);
    }
  }

  liveWebGLCount(): number {
    return this.#governor.liveWebGLCount();
  }

  get openSurfaces(): readonly string[] {
    return [...this.#surfaces.keys()];
  }
}

function priorityOf(plugin: Plugin, capability: CapabilityId): number {
  return plugin.manifest.provides.find((c) => c.id === capability)?.priority ?? 0;
}
