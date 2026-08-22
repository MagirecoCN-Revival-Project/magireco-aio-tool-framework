import type { CapabilityId } from '@aio/core';
import { PLUGIN_CATALOG } from './plugins';

/**
 * 能力 → 提供它的插件 id。
 *
 * ## 为什么必须**推导**出来，不能手写一张表
 *
 * 铁律 10 说「插件的两半共用一个开关」。那条判据落到代码上就是这张表：
 * 边缘半边（`@aio/site` 的路由、`@aio/embed` 的准入）拿它决定放不放行，
 * 浏览器半边拿同一个 id 去 `kernel.unregister()`。
 *
 * 手写一张平行的表，迟早出现「后台显示关着、嵌在别人页面上的还在放」
 * 这种查不出来的状态——而且不会报错，因为两张表各自都是自洽的。
 *
 * 所以这里**从插件目录现场推导**：实例化每个插件，读它 manifest 里
 * `provides` 的能力 id。插件工厂是纯构造，没有副作用，实例读完即弃。
 * 目录里加一个插件，这张表自动跟上；改了它声明的能力，这张表也自动跟上。
 */
export function capabilityProviders(): Readonly<Record<CapabilityId, readonly string[]>> {
  const map = new Map<CapabilityId, string[]>();
  for (const entry of PLUGIN_CATALOG) {
    const manifest = entry.create().manifest;
    // 目录 id 与 manifest id 必须相同，否则 unregister 会静静地什么都不做。
    // `test/catalog.test.ts` 已经钉住这一条，这里按目录 id 记——
    // 因为开关面（后台、@aio/site 的 config.plugins）用的是目录 id。
    for (const cap of manifest.provides) {
      const ids = map.get(cap.id) ?? [];
      ids.push(entry.id);
      map.set(cap.id, ids);
    }
  }
  return Object.fromEntries(map) as Record<CapabilityId, readonly string[]>;
}
