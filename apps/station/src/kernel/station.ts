import { Kernel } from '@aio/kernel';
import type { Plugin } from '@aio/kernel';
import { Manifest, OriginPool, ManifestCdnProvider } from '@aio/resource';
import { Registry } from '@aio/registry';
import { SurfaceStore } from './surface-store';
import { DEMO_MANIFESTS, DEMO_ORIGINS, DEMO_REGISTRY } from '../station/data';
import { PLUGIN_CATALOG } from '../station/plugins';

/**
 * 工作站的运行时单例：内核 + 插件目录 + 启停状态。
 *
 * 「带插件的 CMS」里「带插件」那半句的实现就在这里：插件是**可装可卸**的，
 * 卸掉之后 `kernel.can()` 立刻返回 false，依赖它的按钮随之消失，而宿主其余
 * 部分照常运转——这正是 CLAUDE.md 开头那条判据。
 */

export interface CatalogEntry {
  readonly id: string;
  readonly title: string;
  /** 为什么需要它。后台里显示给维护者看。 */
  readonly note: string;
  readonly create: () => Plugin;
}

export class Station {
  readonly kernel: Kernel;
  readonly surfaces: SurfaceStore;
  readonly catalog: readonly CatalogEntry[] = PLUGIN_CATALOG;

  readonly #enabled = new Set<string>();
  readonly #listeners = new Set<() => void>();
  /** 快照用版本号：插件装卸后 +1，逼所有读 `can()` 的组件重算。 */
  #version = 0;

  constructor() {
    this.surfaces = new SurfaceStore();
    this.kernel = new Kernel({
      resources: new ManifestCdnProvider({
        origins: new OriginPool(DEMO_ORIGINS),
        manifests: DEMO_MANIFESTS.map((doc) => Manifest.from(doc)),
      }),
      registry: Registry.from(DEMO_REGISTRY),
      surfaces: this.surfaces,
      logger: (level, pluginId, msg) => {
        if (level === 'error' || level === 'warn') {
          console[level === 'error' ? 'error' : 'warn'](`[${pluginId}] ${msg}`);
        }
      },
    });

    for (const entry of this.catalog) this.enable(entry.id);
  }

  isEnabled(id: string): boolean {
    return this.#enabled.has(id);
  }

  enable(id: string): void {
    if (this.#enabled.has(id)) return;
    const entry = this.catalog.find((e) => e.id === id);
    if (entry === undefined) return;
    this.kernel.register(entry.create());
    this.#enabled.add(id);
    this.#bump();
  }

  async disable(id: string): Promise<void> {
    if (!this.#enabled.has(id)) return;
    // 先关掉它开着的 surface 再摘能力——顺序反了会留下孤儿 surface。
    // 内核的 unregister 已经保证了这一点，这里只是不重复实现。
    await this.kernel.unregister(id);
    this.#enabled.delete(id);
    this.#bump();
  }

  async toggle(id: string): Promise<void> {
    if (this.#enabled.has(id)) await this.disable(id);
    else this.enable(id);
  }

  readonly subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  };

  readonly getSnapshot = (): number => this.#version;
  readonly getServerSnapshot = (): number => 0;

  #bump(): void {
    this.#version += 1;
    for (const fn of this.#listeners) fn();
  }
}
