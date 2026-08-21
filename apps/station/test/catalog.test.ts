import { describe, expect, it } from 'vitest';
import { parseRef } from '@aio/core';
import { PLUGIN_CATALOG } from '../src/station/plugins';
import { Station } from '../src/kernel/station';

/**
 * 装卸插件这条路。
 *
 * 这里钉的是**框架是否成立的那条判据**：
 *
 * > 拔掉一个模块，宿主依然自洽，只是少一项能力。
 *
 * 它一直只写在文档里。而实际上目录 id 与插件 manifest id 曾经对不上
 * （`sprite-viewer` vs `sprite-play`），`kernel.unregister()` 因此**静静地什么都
 * 没做**——后台开关看着关了，能力其实还在。没有测试会发现这件事，因为
 * 一致性套件只验单个插件，不验宿主的装卸。
 */

describe('插件目录', () => {
  it('每条目录 id 都等于它那个插件 manifest 的 id', () => {
    // 不等的话 disable() 拿目录 id 去 unregister 会静静落空。
    for (const entry of PLUGIN_CATALOG) {
      expect(entry.create().manifest.id, `目录项 ${entry.title}`).toBe(entry.id);
    }
  });

  it('目录 id 不重复——内核按 id 存插件，重的那个会顶掉前一个', () => {
    const ids = PLUGIN_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每条都写了 note——后台要显示给维护者看「为什么需要它」', () => {
    for (const entry of PLUGIN_CATALOG) expect(entry.note.length).toBeGreaterThan(0);
  });
});

describe('Station 的装卸', () => {
  const cases: readonly (readonly [string, string, string])[] = [
    ['sprite-play', 'sprite.show', 'a:sprite/100100/d_r'],
    ['adv-play', 'adv.play', 'a:scenario/310241@zh'],
    ['chart-height', 'chart.height', 'a:character/1001'],
    ['model3d-gltf', 'model3d.show', 'b:model3d/100101'],
  ];

  it('开箱即装全部', () => {
    const station = new Station();
    for (const entry of PLUGIN_CATALOG) expect(station.isEnabled(entry.id)).toBe(true);
  });

  it.each(cases)('拔掉 %s 之后 can(%s) 变假，其余能力不受影响', async (id, cap, ref) => {
    const station = new Station();
    expect(station.kernel.can(cap as never, parseRef(ref))).toBe(true);

    await station.disable(id);
    expect(station.isEnabled(id)).toBe(false);
    // 这一句才是判据本身：UI 据此不画按钮。
    expect(station.kernel.can(cap as never, parseRef(ref))).toBe(false);

    for (const [otherId, otherCap, otherRef] of cases) {
      if (otherId === id) continue;
      expect(
        station.kernel.can(otherCap as never, parseRef(otherRef)),
        `拔掉 ${id} 影响到了 ${otherCap}`,
      ).toBe(true);
    }

    // 装回来能力就回来——装卸是可逆的，不是一次性的。
    station.enable(id);
    expect(station.kernel.can(cap as never, parseRef(ref))).toBe(true);
  });
});
