import type { SurfaceHint } from '@aio/core';
import type { Plugin, SurfaceProvider, SurfaceTarget } from '@aio/kernel';

/**
 * 写插件用的小工具。刻意保持极薄——SDK 越厚，插件越难被别的宿主复用。
 */

/** 加个类型标注而已，但能让 manifest 的错误在写的时候就报出来。 */
export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}

/**
 * 无头 surface 提供者：测试与 SSR 预检用。
 * 不建 DOM，只发 surfaceId，这样内核逻辑可以在 node 上完整跑一遍。
 */
export function createHeadlessSurfaceProvider(options: { max?: number } = {}): SurfaceProvider & {
  readonly active: readonly string[];
} {
  const max = options.max ?? Infinity;
  const active = new Set<string>();
  return {
    get active() {
      return [...active];
    },
    acquire(surfaceId: string, hint: SurfaceHint): SurfaceTarget | null {
      if (active.size >= max) return null;
      active.add(surfaceId);
      return { surfaceId, container: null, hint };
    },
    release(surfaceId: string) {
      active.delete(surfaceId);
    },
  };
}
