import type { ResourceRef } from './ref.js';

/**
 * 插件间的**回话通道**。
 *
 * 单向调用只能做到「点一下打开另一个东西」。真正的有机整合需要反向的进度回流：
 * ADV 播到第 42 行时，剧情阅读器要把第 42 行高亮起来。所以内核带一条类型化
 * 事件总线，插件发布自己的状态，别的插件订阅——**依然互不 import**。
 */
export interface FrameworkEventMap {
  /** 某个 surface 上的插件开始呈现某个资源。 */
  'surface.opened': { surfaceId: string; pluginId: string; ref: ResourceRef };
  'surface.closed': { surfaceId: string; pluginId: string };
  /** 播放/浏览进度。`position` 的含义由 kind 决定（剧情=行号，语音=毫秒）。 */
  progress: { surfaceId: string; ref: ResourceRef; position: number; total?: number };
  /** 用户在某个插件里选中了另一个实体（如 ADV 里点了角色立绘）。 */
  'entity.focused': { surfaceId: string; ref: ResourceRef };
  /** 资源加载失败，供宿主统一提示与降级。 */
  'resource.failed': { ref: ResourceRef; reason: string };
}

export type FrameworkEventName = keyof FrameworkEventMap;

export type Listener<K extends FrameworkEventName> = (payload: FrameworkEventMap[K]) => void;

export interface EventBus {
  on<K extends FrameworkEventName>(name: K, fn: Listener<K>): () => void;
  emit<K extends FrameworkEventName>(name: K, payload: FrameworkEventMap[K]): void;
}

export function createEventBus(onListenerError?: (err: unknown) => void): EventBus {
  const listeners = new Map<FrameworkEventName, Set<(p: never) => void>>();

  return {
    on(name, fn) {
      let set = listeners.get(name);
      if (set === undefined) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(fn as (p: never) => void);
      return () => {
        set.delete(fn as (p: never) => void);
      };
    },
    emit(name, payload) {
      const set = listeners.get(name);
      if (set === undefined) return;
      // 快照迭代：监听器里退订不会影响本轮派发。
      for (const fn of [...set]) {
        try {
          (fn as (p: FrameworkEventMap[typeof name]) => void)(payload);
        } catch (err) {
          // 一个订阅者抛错不能让其余订阅者收不到——这条总线是跨插件的，
          // 让第三方插件的 bug 能静默掐断宿主的事件流是不可接受的。
          onListenerError?.(err);
        }
      }
    },
  };
}
