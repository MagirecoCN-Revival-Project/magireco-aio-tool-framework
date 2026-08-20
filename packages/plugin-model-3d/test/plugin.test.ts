import { describe, expect, it, vi } from 'vitest';
import { parseRef } from '@aio/core';
import { Kernel } from '@aio/kernel';
import { Manifest, OriginPool, ResourceClient } from '@aio/resource';
import { createHeadlessSurfaceProvider } from '@aio/plugin-sdk';
import {
  createModel3dPlugin,
  type CharacterManagerLike,
  type Model3dDeps,
  type SceneCharacterLike,
  type SceneLike,
} from '../src/index.js';

/**
 * 整条链路在 node 上跑：内核派发意图 → 插件按清单构造 files → 装载角色 →
 * 治理器挂起/恢复 → 卸载。**没有浏览器，也没有 three.js**——上游那两个类
 * 是注入进来的，所以这些判据不需要 GPU 就能验。
 */

class FakeManager implements CharacterManagerLike {
  constructor(readonly files: Record<string, string>) {}
  async loadCharacterById(): Promise<unknown> {
    return {};
  }
}

function fakeScene() {
  const added: (string | number)[] = [];
  const removed: SceneCharacterLike[] = [];
  const scene: SceneLike = {
    async addCharacter(id) {
      added.push(id);
      return { id };
    },
    removeCharacter(c) {
      removed.push(c);
    },
  };
  return { scene, added, removed };
}

function setup(overrides: Partial<Model3dDeps> = {}) {
  const { scene, added, removed } = fakeScene();
  const setRenderPaused = vi.fn<(paused: boolean) => void>();

  const deps: Model3dDeps = {
    CharacterManager: FakeManager,
    Scene: class {
      constructor(_m: CharacterManagerLike) {
        return scene as never;
      }
    } as unknown as Model3dDeps['Scene'],
    setRenderPaused,
    ...overrides,
  };

  const kernel = new Kernel({
    resources: new ResourceClient({
      origins: new OriginPool([{ base: 'https://assets.example.com/', weight: 1 }]),
      manifests: [
        Manifest.from({
          version: 1,
          universe: 'b',
          kind: 'model3d',
          entries: {
            'b:model3d/100101': {
              parts: [{ path: '3d/chara_100101/model.fbx.gz', role: 'model' }],
            },
          },
        }),
      ],
    }),
    surfaces: createHeadlessSurfaceProvider(),
  });
  kernel.register(createModel3dPlugin(deps));
  return { kernel, added, removed, setRenderPaused };
}

const REF = parseRef('b:model3d/100101');

describe('createModel3dPlugin', () => {
  it('声明了 usesWebGL —— 不声明的话浏览器会静默丢弃最早的上下文', () => {
    const plugin = createModel3dPlugin({
      CharacterManager: FakeManager,
      Scene: class {} as unknown as Model3dDeps['Scene'],
    });
    expect(plugin.manifest.usesWebGL).toBe(true);
    // three.js 是 ESM 不挂全局，所以 inline——与契约里的 example-model-viewer 一致。
    expect(plugin.manifest.isolation).toBe('inline');
  });

  it('清单里有这条 ref 时 can() 为真，没有时为假', () => {
    const { kernel } = setup();
    expect(kernel.can('model3d.show', REF)).toBe(true);
    expect(kernel.can('model3d.show', parseRef('b:model3d/999999'))).toBe(false);
  });

  it('派发意图后按清单里的角色号装载', async () => {
    const { kernel, added } = setup();
    const handle = await kernel.request({ capability: 'model3d.show', ref: REF });
    expect(handle).not.toBeNull();
    expect(added).toEqual(['100101']);
  });

  it('卸载时移除角色并停掉渲染循环，且重复调用无副作用', async () => {
    const { kernel, removed, setRenderPaused } = setup();
    const handle = await kernel.request({ capability: 'model3d.show', ref: REF });
    await handle?.close();

    expect(removed).toHaveLength(1);
    expect(setRenderPaused).toHaveBeenCalledWith(true);

    const before = setRenderPaused.mock.calls.length;
    await handle?.close(); // 幂等：治理器会反复调
    expect(setRenderPaused.mock.calls.length).toBe(before);
  });

  it('没有注入 setRenderPaused 时也不炸——只是挂起省不下 GPU', async () => {
    const { kernel } = setup({ setRenderPaused: undefined as never });
    const handle = await kernel.request({ capability: 'model3d.show', ref: REF });
    await expect(handle?.close()).resolves.toBeUndefined();
  });
});
