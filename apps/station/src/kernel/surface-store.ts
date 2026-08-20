import type { SurfaceHint } from '@aio/core';
import type { SurfaceProvider, SurfaceTarget } from '@aio/kernel';

/**
 * 内核与 React 之间的 surface 桥。
 *
 * 难点只有一个：内核的 `acquire()` 是**同步**的，必须当场返回一个可挂载的
 * DOM 容器；而 React 的渲染是异步的，容器要等下一次 commit 才存在。
 *
 * 解法是平台原语，不是框架技巧（ADR 0001）：`acquire()` 当场
 * `document.createElement` 造一个**游离**容器交给插件，插件立刻就能往里画；
 * React 那边订阅本 store，渲染出各自的外框，再用 ref 回调把这个游离节点
 * `append` 进去。插件从头到尾不知道自己被挂在 React 树里——它只看到一个
 * `HTMLElement`，与在 demo 那个无框架宿主里拿到的完全一样。
 *
 * 这正是「宿主可以是任何技术栈」在代码层面的样子：换成 Vue 或 Svelte，
 * 要重写的只有 SurfaceOutlet，本文件与内核一行都不用动。
 */

export interface OpenSurface {
  readonly surfaceId: string;
  readonly pluginId: string;
  readonly hint: SurfaceHint;
  readonly container: HTMLElement;
}

/** SSR 时没有 surface——内核只在浏览器里派发意图。 */
const EMPTY: readonly OpenSurface[] = Object.freeze([]);

export class SurfaceStore implements SurfaceProvider {
  #surfaces: readonly OpenSurface[] = EMPTY;
  readonly #listeners = new Set<() => void>();

  /**
   * 内核要一个挂载点。返回 null 表示当前拒开新 surface。
   *
   * 这里不限制数量：数量治理是内核 `ContextGovernor` 的职责（按 LRU 挂起
   * 最久未用的 WebGL 实例），宿主再加一层会和它打架。
   */
  acquire(surfaceId: string, hint: SurfaceHint, pluginId: string): SurfaceTarget | null {
    if (typeof document === 'undefined') return null;
    const container = document.createElement('div');
    container.className = 'surface-body';
    container.dataset['pluginId'] = pluginId;
    this.#surfaces = [...this.#surfaces, { surfaceId, pluginId, hint, container }];
    this.#emit();
    return { surfaceId, container, hint };
  }

  release(surfaceId: string): void {
    const next = this.#surfaces.filter((s) => s.surfaceId !== surfaceId);
    if (next.length === this.#surfaces.length) return;
    this.#surfaces = next;
    this.#emit();
  }

  /** useSyncExternalStore 的三件套。快照是不可变数组，引用不变即不重渲染。 */
  readonly subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  };

  readonly getSnapshot = (): readonly OpenSurface[] => this.#surfaces;
  readonly getServerSnapshot = (): readonly OpenSurface[] => EMPTY;

  #emit(): void {
    for (const fn of this.#listeners) fn();
  }
}
