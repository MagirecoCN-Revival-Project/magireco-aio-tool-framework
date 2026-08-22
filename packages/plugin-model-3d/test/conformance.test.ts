import { parseRef } from '@aio/core';
import { MODEL3D_SHOW } from '@aio/capability';
import { runCapabilityConformance } from '@aio/conformance';
import { Manifest, ManifestCdnProvider, OriginPool } from '@aio/resource';
import { createModel3dPlugin, type CharacterManagerLike, type Model3dDeps } from '../src/index.js';

/**
 * 把 wrapper 适配器丢进**与实现无关**的能力套件。
 *
 * 同一份判据，`packages/conformance/test/reference.test.ts` 里那个从零写的
 * 参考实现也在跑。两边都过，说明契约测的是契约，不是某一个实现——
 * 「换一个 model3d.show 实现，宿主零改动」因此是可验证的，不是愿望。
 */

class FakeManager implements CharacterManagerLike {
  constructor(readonly files: Record<string, string>) {}
  async loadCharacterById(): Promise<unknown> {
    return {};
  }
}

const deps: Model3dDeps = {
  CharacterManager: FakeManager,
  Scene: class {
    async addCharacter(id: string | number): Promise<object> {
      return { id };
    }
    removeCharacter(): void {}
  } as unknown as Model3dDeps['Scene'],
};

runCapabilityConformance({
  name: 'plugin-model-3d（上游查看器适配器）',
  contract: MODEL3D_SHOW,
  createPlugin: () => createModel3dPlugin(deps),
  createResources: () =>
    new ManifestCdnProvider({
      origins: new OriginPool([{ base: 'https://assets.example/', weight: 1 }]),
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
  present: parseRef('b:model3d/100101'),
  absent: parseRef('b:model3d/999999'),
});
