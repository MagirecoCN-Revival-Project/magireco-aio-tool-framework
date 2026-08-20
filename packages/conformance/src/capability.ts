import { describe, expect, it, vi } from 'vitest';
import { isValidCapabilityId, type ResourceRef } from '@aio/core';
import type { CapabilityContract } from '@aio/capability';
import { Kernel, type Plugin } from '@aio/kernel';
import { createHeadlessSurfaceProvider } from '@aio/plugin-sdk';
import type { ResourceProvider } from '@aio/resource';

/**
 * 能力一致性套件（ADR 0002 第二层的产物）。
 *
 * **本文件不 import 任何具体实现**——只有契约、内核与接口。所以
 * 「某某是 `adv.play` 的一个合格实现」变成能被验证的事，而不是靠读代码相信。
 *
 * 判据都跑在 node 上：内核、事件总线、生命周期都不需要浏览器。
 * 需要 GPU 才能验的部分（画得对不对）**不属于契约**——契约管的是
 * 「能被怎么用」，不是「画成什么样」。
 */

export interface CapabilityFixture {
  /** 实现的名字，出现在测试标题里。 */
  readonly name: string;
  readonly contract: CapabilityContract;
  createPlugin(): Plugin;
  /** 造一个含 `present`、不含 `absent` 的资源提供者。 */
  createResources(): ResourceProvider;
  readonly present: ResourceRef;
  readonly absent: ResourceRef;
}

export function runCapabilityConformance(fixture: CapabilityFixture): void {
  const { contract } = fixture;

  const boot = (): Kernel => {
    const kernel = new Kernel({
      resources: fixture.createResources(),
      surfaces: createHeadlessSurfaceProvider(),
    });
    kernel.register(fixture.createPlugin());
    return kernel;
  };

  describe(`能力一致性 ${contract.id} ← ${fixture.name}`, () => {
    it('manifest 声明了这个能力，且能力标识合约定', () => {
      const cap = fixture
        .createPlugin()
        .manifest.provides.find((c) => c.id === contract.id);
      expect(cap, `没有声明 ${contract.id}`).toBeDefined();
      expect(isValidCapabilityId(contract.id)).toBe(true);
    });

    it('accepts 覆盖契约要求的每个 kind', () => {
      const cap = fixture.createPlugin().manifest.provides.find((c) => c.id === contract.id)!;
      for (const kind of contract.accepts) {
        // 少接一个 kind，宿主按契约画出来的入口就会点下去没人处理。
        expect(cap.accepts, `未接受 ${kind}`).toContain(kind);
      }
    });

    it('usesWebGL 与契约一致', () => {
      const m = fixture.createPlugin().manifest;
      // 占了却不声明，后果不是报错，是别人已打开的查看器突然变黑（铁律 5）。
      expect(m.usesWebGL ?? false).toBe(contract.usesWebGL);
    });

    it('资源不在清单里时 can() 为假——不画按钮，而不是点了才 404', () => {
      const kernel = boot();
      expect(kernel.can(contract.id, fixture.present)).toBe(true);
      expect(kernel.can(contract.id, fixture.absent)).toBe(false);
    });

    it('派发意图能挂载', async () => {
      const kernel = boot();
      const handle = await kernel.request({ capability: contract.id, ref: fixture.present });
      expect(handle).not.toBeNull();
      expect(handle!.pluginId).toBe(fixture.createPlugin().manifest.id);
      await handle!.close();
    });

    it('容忍未知参数——契约会长出新参数，老实现不能因此崩', async () => {
      const kernel = boot();
      const handle = await kernel.request({
        capability: contract.id,
        ref: fixture.present,
        // 故意混入契约里没有的参数
        params: { __未来才会有的参数__: 42, line: 3, q: 'x' },
      });
      expect(handle).not.toBeNull();
      await handle!.close();
    });

    it('关闭是幂等的——治理器会反复调', async () => {
      const kernel = boot();
      const handle = await kernel.request({ capability: contract.id, ref: fixture.present });
      await handle!.close();
      await expect(handle!.close()).resolves.toBeUndefined();
    });

    it('关闭之后不再发事件', async () => {
      // 定时器要在 mount **之前**装好，否则实现里的 setInterval 拿到的是真定时器。
      // 代价是：mount 里若 await 真定时器，这条会挂——那本身也是个该被发现的问题，
      // 挂载不该阻塞在墙钟上。
      vi.useFakeTimers();
      try {
        const kernel = boot();
        const handle = await kernel.request({ capability: contract.id, ref: fixture.present });
        await handle!.close();

        const leaked: string[] = [];
        for (const name of ['progress', 'entity.focused', 'resource.failed'] as const) {
          kernel.events.on(name, () => leaked.push(name));
        }
        // 泄漏的 setInterval 在这十秒里一定会露头。
        await vi.advanceTimersByTimeAsync(10_000);
        expect(leaked, `关闭后仍在发事件：${leaked.join('、')}`).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    if (contract.emits.includes('progress')) {
      it('被驱动时发 progress——只能打开不能回话的东西是跳转链接，不是插件', async () => {
        vi.useFakeTimers();
        try {
          const kernel = boot();
          const seen: { position: number }[] = [];
          kernel.events.on('progress', (p) => seen.push({ position: p.position }));

          const handle = await kernel.request({
            capability: contract.id,
            ref: fixture.present,
            params: { line: 1 },
          });
          await vi.advanceTimersByTimeAsync(10_000);
          expect(seen.length, '整整十秒没有任何进度回流').toBeGreaterThan(0);
          await handle!.close();
        } finally {
          vi.useRealTimers();
        }
      });
    }
  });
}
