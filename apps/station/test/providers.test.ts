import { describe, expect, it } from 'vitest';
import { contractOf } from '@aio/capability';
import { DEFAULT_CONFIG } from '@aio/site';
import { resolveEmbed } from '@aio/embed';
import { PLUGIN_CATALOG } from '../src/station/plugins';
import { capabilityProviders } from '../src/station/providers';

/**
 * 铁律 10：**插件的两半共用一个开关。**
 *
 * 这张能力→插件 id 的表是那条铁律唯一的落点：边缘半边（`@aio/site` 的路由、
 * `@aio/embed` 的准入）拿它决定放不放行，浏览器半边拿同一个 id 去
 * `kernel.unregister()`。两边用的 id 不是同一个的话，会得到一个
 * **不报错的坏状态**：后台显示关着，嵌在别人页面上的还在放。
 *
 * 所以这里验的不是「函数返回了点什么」，而是「它与目录、与契约、与嵌入准入
 * 四方一致」。
 */

describe('能力提供者表', () => {
  const providers = capabilityProviders();

  it('表里出现的每个插件 id 都在目录里', () => {
    const catalogIds = new Set(PLUGIN_CATALOG.map((e) => e.id));
    for (const [cap, ids] of Object.entries(providers)) {
      for (const id of ids) {
        expect(catalogIds.has(id), `${cap} 指向了不在目录里的 ${id}`).toBe(true);
      }
    }
  });

  it('目录里每个插件声明的每项能力都在表里', () => {
    for (const entry of PLUGIN_CATALOG) {
      for (const cap of entry.create().manifest.provides) {
        expect(providers[cap.id] ?? [], `${entry.id} 的 ${cap.id}`).toContain(entry.id);
      }
    }
  });

  it('🔴 表里的能力必须都有契约——没契约的能力嵌不出去也接不进来', () => {
    for (const cap of Object.keys(providers)) {
      expect(contractOf(cap as never), `${cap} 没有登记契约`).not.toBeNull();
    }
  });

  it('🔴 关掉一个插件，它提供的能力就嵌不出去了', () => {
    // 这一条是铁律 10 的**端到端**验证：走的是真的 resolveEmbed，
    // 用的是真的目录推导出来的表，改的是真的 config.plugins 开关。
    const entry = PLUGIN_CATALOG.find((e) => e.id === 'sprite-play');
    expect(entry, 'sprite-play 应当在目录里').toBeDefined();

    const opts = {
      policy: { allowedAncestors: ['https://wiki.example.org'] },
      capabilityProviders: providers,
    };
    const q = 'ref=a:sprite/100100/d_r';

    const on = resolveEmbed('/embed/sprite.show', q, { ...opts, config: DEFAULT_CONFIG });
    expect(on.status).toBe(200);

    const off = resolveEmbed('/embed/sprite.show', q, {
      ...opts,
      config: { ...DEFAULT_CONFIG, plugins: { 'sprite-play': { enabled: false } } },
    });
    expect(off.status).toBe(404);
    if (off.status === 200) return;
    expect(off.reason).toBe('plugin-disabled');
  });

  it('没装实现的能力报 no-provider，而不是假装能放', () => {
    // 契约表有 6 条，station 只装了 4 个插件。剩下那两条的嵌入 URL
    // 是存在的（静态页烘出来了），但必须如实说「这个部署放不了」。
    const d = resolveEmbed('/embed/search.query', 'ref=a:character/1001', {
      config: DEFAULT_CONFIG,
      policy: { allowedAncestors: ['https://wiki.example.org'] },
      capabilityProviders: providers,
    });
    expect(d.status).toBe(404);
    if (d.status === 200) return;
    expect(d.reason).toBe('no-provider');
  });
});
