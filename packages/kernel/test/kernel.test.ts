import { beforeEach, describe, expect, it } from 'vitest';
import { Kernel, KernelError } from '@aio/kernel';
import { createHeadlessSurfaceProvider } from '@aio/plugin-sdk';
import { fakePlugin, makeResources, refs, registry, type Recorder } from './fixtures.js';

function makeKernel(opts: { maxLiveWebGL?: number; maxSurfaces?: number } = {}) {
  const rec: Recorder = { calls: [] };
  const surfaces = createHeadlessSurfaceProvider(
    opts.maxSurfaces === undefined ? {} : { max: opts.maxSurfaces },
  );
  const kernel = new Kernel({
    resources: makeResources(),
    registry,
    surfaces,
    governor: opts.maxLiveWebGL === undefined ? {} : { maxLiveWebGL: opts.maxLiveWebGL },
  });
  return { kernel, rec, surfaces };
}

describe('插件注册', () => {
  it('拒绝重复注册', () => {
    const { kernel, rec } = makeKernel();
    kernel.register(fakePlugin('a', { capability: 'adv.play', accepts: ['scenario'] }, rec));
    expect(() =>
      kernel.register(fakePlugin('a', { capability: 'adv.play', accepts: ['scenario'] }, rec)),
    ).toThrow(KernelError);
  });

  it('拒绝不合约定的能力标识与空能力', () => {
    const { kernel, rec } = makeKernel();
    expect(() =>
      kernel.register(fakePlugin('b', { capability: 'PlayADV', accepts: ['scenario'] }, rec)),
    ).toThrow(/能力标识/);
    expect(() => kernel.register(fakePlugin('c', { capability: 'x.y', accepts: [] }, rec))).toThrow(
      /没声明接受/,
    );
  });
});

describe('能力查询 can()', () => {
  let ctx: ReturnType<typeof makeKernel>;
  beforeEach(() => {
    ctx = makeKernel();
    ctx.kernel.register(
      fakePlugin('adv', { capability: 'adv.play', accepts: ['scenario'] }, ctx.rec),
    );
  });

  it('装了插件且资源在清单里 → 可用', () => {
    expect(ctx.kernel.can('adv.play', refs.scenario)).toBe(true);
  });

  it('没装对应插件 → 不可用（按钮不该画出来）', () => {
    expect(ctx.kernel.can('sprite.show', refs.sprite1001)).toBe(false);
  });

  it('kind 不匹配 → 不可用', () => {
    expect(ctx.kernel.can('adv.play', refs.chara1001)).toBe(false);
  });

  it('资源清单里没有 → 不可用。装了插件也打不开不存在的东西', () => {
    expect(ctx.kernel.can('adv.play', refs.missingScenario)).toBe(false);
  });

  it('多提供者按 priority 排序', () => {
    ctx.kernel.register(
      fakePlugin('adv2', { capability: 'adv.play', accepts: ['scenario'], priority: 10 }, ctx.rec),
    );
    expect(ctx.kernel.providersFor('adv.play', refs.scenario)).toEqual(['adv2', 'adv']);
  });
});

describe('意图派发', () => {
  it('挂载并发出 surface.opened', async () => {
    const { kernel, rec } = makeKernel();
    kernel.register(fakePlugin('adv', { capability: 'adv.play', accepts: ['scenario'] }, rec));

    const opened: string[] = [];
    kernel.events.on('surface.opened', (p) => opened.push(`${p.pluginId}:${p.ref.segments[0]}`));

    const handle = await kernel.request({ capability: 'adv.play', ref: refs.scenario });
    expect(handle).not.toBeNull();
    expect(handle!.pluginId).toBe('adv');
    expect(opened).toEqual(['adv:310241']);
    expect(rec.calls).toContain('adv:mount:sf-1');
  });

  it('没有提供者返回 null，不抛错——「这个能力没装」是正常状态', async () => {
    const { kernel } = makeKernel();
    expect(await kernel.request({ capability: 'sprite.show', ref: refs.sprite1001 })).toBeNull();
  });

  it('同一插件重复请求走 update，不开第二个 surface', async () => {
    const { kernel, rec } = makeKernel();
    kernel.register(
      fakePlugin('adv', { capability: 'adv.play', accepts: ['scenario'], supportsUpdate: true }, rec),
    );
    await kernel.request({ capability: 'adv.play', ref: refs.scenario });
    await kernel.request({ capability: 'adv.play', ref: refs.scenario });
    expect(kernel.openSurfaces).toHaveLength(1);
    expect(rec.calls.filter((c) => c.startsWith('adv:mount'))).toHaveLength(1);
    expect(rec.calls).toContain('adv:update:310241');
  });

  it('宿主拒绝分配 surface 时返回 null', async () => {
    const { kernel, rec } = makeKernel({ maxSurfaces: 0 });
    kernel.register(fakePlugin('adv', { capability: 'adv.play', accepts: ['scenario'] }, rec));
    expect(await kernel.request({ capability: 'adv.play', ref: refs.scenario })).toBeNull();
  });

  it('挂载失败要把 surface 还回宿主，不留空壳', async () => {
    const { kernel, surfaces } = makeKernel();
    kernel.register({
      manifest: {
        id: 'bad', version: '0', title: 'bad', isolation: 'inline',
        provides: [{ id: 'adv.play', accepts: ['scenario'] }],
      },
      mount: async () => {
        throw new Error('初始化炸了');
      },
    });
    await expect(kernel.request({ capability: 'adv.play', ref: refs.scenario })).rejects.toThrow(
      /挂载.*失败/,
    );
    expect(surfaces.active).toEqual([]);
  });

  it('close 走 dispose 并归还 surface', async () => {
    const { kernel, rec, surfaces } = makeKernel();
    kernel.register(fakePlugin('adv', { capability: 'adv.play', accepts: ['scenario'] }, rec));
    const h = await kernel.request({ capability: 'adv.play', ref: refs.scenario });
    await h!.close();
    expect(rec.calls).toContain('adv:dispose');
    expect(surfaces.active).toEqual([]);
    expect(kernel.openSurfaces).toEqual([]);
  });

  it('dispose 抛错也必须归还 surface——坏插件不能漏掉宿主容器', async () => {
    const { kernel, surfaces } = makeKernel();
    kernel.register({
      manifest: {
        id: 'leaky', version: '0', title: 'leaky', isolation: 'inline',
        provides: [{ id: 'adv.play', accepts: ['scenario'] }],
      },
      mount: async () => ({
        suspend: () => {}, resume: () => {},
        dispose: () => { throw new Error('拆的时候炸了'); },
      }),
    });
    const h = await kernel.request({ capability: 'adv.play', ref: refs.scenario });
    await expect(h!.close()).rejects.toThrow('拆的时候炸了');
    expect(surfaces.active).toEqual([]);
  });
});

describe('WebGL 上下文治理', () => {
  it('超额时按 LRU 挂起最久未用的实例', async () => {
    const { kernel, rec } = makeKernel({ maxLiveWebGL: 2 });
    for (const id of ['v1', 'v2', 'v3']) {
      kernel.register(
        fakePlugin(id, { capability: `${id}.show`, accepts: ['sprite'], usesWebGL: true }, rec),
      );
    }
    await kernel.request({ capability: 'v1.show', ref: refs.sprite1001 });
    await kernel.request({ capability: 'v2.show', ref: refs.sprite1001 });
    expect(rec.calls.filter((c) => c.endsWith(':suspend'))).toEqual([]);

    await kernel.request({ capability: 'v3.show', ref: refs.sprite1001 });
    // v1 最久未用 → 被挂起，而不是让浏览器静默丢弃它的上下文
    expect(rec.calls).toContain('v1:suspend');
    expect(kernel.liveWebGLCount()).toBe(2);
  });

  it('不占 WebGL 的插件不参与治理', async () => {
    const { kernel, rec } = makeKernel({ maxLiveWebGL: 1 });
    kernel.register(fakePlugin('t1', { capability: 't1.show', accepts: ['sprite'] }, rec));
    kernel.register(fakePlugin('t2', { capability: 't2.show', accepts: ['sprite'] }, rec));
    await kernel.request({ capability: 't1.show', ref: refs.sprite1001 });
    await kernel.request({ capability: 't2.show', ref: refs.sprite1001 });
    expect(rec.calls.filter((c) => c.endsWith(':suspend'))).toEqual([]);
  });

  it('touch 恢复被挂起的实例', async () => {
    const { kernel, rec } = makeKernel({ maxLiveWebGL: 1 });
    kernel.register(fakePlugin('a', { capability: 'a.show', accepts: ['sprite'], usesWebGL: true }, rec));
    kernel.register(fakePlugin('b', { capability: 'b.show', accepts: ['sprite'], usesWebGL: true }, rec));
    const ha = await kernel.request({ capability: 'a.show', ref: refs.sprite1001 });
    await kernel.request({ capability: 'b.show', ref: refs.sprite1001 });
    expect(rec.calls).toContain('a:suspend');

    await kernel.touch(ha!.surfaceId);
    expect(rec.calls).toContain('a:resume');
    // 预算仍是 1，所以 b 反过来被挂起
    expect(rec.calls).toContain('b:suspend');
    expect(kernel.liveWebGLCount()).toBe(1);
  });
});

describe('插件卸载', () => {
  it('卸载后 can() 立刻为 false，按钮随之消失', async () => {
    const { kernel, rec } = makeKernel();
    kernel.register(fakePlugin('adv', { capability: 'adv.play', accepts: ['scenario'] }, rec));
    expect(kernel.can('adv.play', refs.scenario)).toBe(true);

    await kernel.unregister('adv');
    expect(kernel.can('adv.play', refs.scenario)).toBe(false);
    expect(kernel.plugins).toEqual([]);
    expect(await kernel.request({ capability: 'adv.play', ref: refs.scenario })).toBeNull();
  });

  it('卸载会关掉它开着的 surface 并归还宿主容器', async () => {
    const { kernel, rec, surfaces } = makeKernel();
    kernel.register(fakePlugin('adv', { capability: 'adv.play', accepts: ['scenario'] }, rec));
    await kernel.request({ capability: 'adv.play', ref: refs.scenario });
    expect(kernel.openSurfaces).toHaveLength(1);

    await kernel.unregister('adv');
    expect(rec.calls).toContain('adv:dispose');
    expect(kernel.openSurfaces).toEqual([]);
    expect(surfaces.active).toEqual([]);
  });

  it('卸载其中一个提供者，另一个仍在', async () => {
    const { kernel, rec } = makeKernel();
    kernel.register(fakePlugin('a', { capability: 'adv.play', accepts: ['scenario'] }, rec));
    kernel.register(fakePlugin('b', { capability: 'adv.play', accepts: ['scenario'], priority: 5 }, rec));
    await kernel.unregister('b');
    expect(kernel.providersFor('adv.play', refs.scenario)).toEqual(['a']);
  });

  it('卸载不存在的插件是无操作', async () => {
    const { kernel } = makeKernel();
    await expect(kernel.unregister('nope')).resolves.toBeUndefined();
  });
});
