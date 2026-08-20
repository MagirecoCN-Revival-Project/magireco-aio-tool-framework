import { Manifest, ManifestCdnProvider, OriginPool, StaticProvider } from '@aio/resource';
import {
  runResourceProviderConformance,
  SHA,
  type ProviderFixture,
} from '@aio/conformance';

/**
 * 同一套判据，两个实现各跑一遍。
 *
 * 这才是 ADR 0002 那句「换一个 provider 零改动」的**验收**：两边走的是
 * 完全不同的取址方式（清单 + 权重选路 vs 一张固定表），而调用方一行不用分支。
 *
 * 加第三个实现时在这里加一个 fixture，套件本身不动。
 */

const cdn: ProviderFixture = {
  name: 'ManifestCdnProvider（清单 + 多源回退）',
  create(options = {}) {
    return new ManifestCdnProvider({
      origins: new OriginPool([
        { base: 'https://fast.example/', weight: 80 },
        { base: 'https://slow.example/', weight: 10 },
      ]),
      manifests: [
        Manifest.from({
          version: 1,
          universe: 'a',
          kind: 'sprite',
          entries: {
            'a:sprite/100100/d_r': {
              parts: [
                { path: '100100/d_r.ExportJson', role: 'definition' },
                { path: '100100/d_r0.png', role: 'texture' },
              ],
            },
            'a:sprite/1': { parts: [{ path: 'a.png', role: 'texture', sha256: SHA }] },
          },
        }),
      ],
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.subtle === undefined ? {} : { subtle: options.subtle }),
    });
  },
};

const staticTable: ProviderFixture = {
  name: 'StaticProvider（离线包 / 本地目录）',
  create(options = {}) {
    return new StaticProvider({
      entries: {
        'a:sprite/100100/d_r': [
          { role: 'definition', path: '100100/d_r.ExportJson', url: 'blob:definition' },
          { role: 'texture', path: '100100/d_r0.png', url: 'blob:texture' },
        ],
        'a:sprite/1': [{ role: 'texture', path: 'a.png', url: 'blob:sha', sha256: SHA }],
      },
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.subtle === undefined ? {} : { subtle: options.subtle }),
    });
  },
};

runResourceProviderConformance(cdn);
runResourceProviderConformance(staticTable);
