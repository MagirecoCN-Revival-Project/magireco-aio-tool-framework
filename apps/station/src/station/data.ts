import type { RegistryData } from '@aio/registry';
import type { ManifestDoc, OriginConfig } from '@aio/resource';

/**
 * 骨架期的交叉表与资源清单。
 *
 * **这里没有任何版权素材，也不可能有**（铁律 9）：清单里存的是 *路径字符串*，
 * 指向资源面（COS + EdgeOne CDN）；素材本身永远不进这棵树。
 * `tools/check-assets.py` 会拦下任何试图把它们放进来的改动。
 *
 * 角色 ID 与关联关系取自上游仓库实测（见 docs/AIO-ARCHITECTURE.md §二 的证据表），
 * **不是按编号规律推的**——推不出来，那条规律不成立。
 * Phase 4 会把它换成 `registry/data/*.json` 里人工核对过的全量数据。
 */

/** 两条源用来演示多源回退。`.invalid` 是保留 TLD，不会误连到任何真实主机。 */
export const DEMO_ORIGINS: readonly OriginConfig[] = [
  { base: 'https://assets.example.invalid/', weight: 10, name: '主源（COS + EdgeOne）' },
  { base: 'https://backup.example.invalid/', weight: 1, name: '备源' },
];

export const DEMO_REGISTRY: RegistryData = {
  version: 1,
  generated: '2026-08-20',
  entities: [
    {
      ref: 'a:character/1001',
      nameZh: '角色甲',
      nameJa: '角色甲',
      links: {
        sprite: ['a:sprite/100100/d_r'],
        scenario: ['a:scenario/310241@zh'],
      },
    },
    {
      ref: 'b:character/100101',
      nameZh: '角色乙',
      nameJa: '角色乙',
      // 与上面那条同为「1001xx」段却是**另一个人**——universe 前缀就是为这件事存在的。
      links: {
        model3d: ['b:model3d/100101'],
      },
    },
  ],
};

export const DEMO_MANIFESTS: readonly ManifestDoc[] = [
  {
    version: 1,
    universe: 'a',
    kind: 'sprite',
    entries: {
      'a:sprite/100100/d_r': {
        parts: [
          { path: 'sprite/100100/d_r.ExportJson', role: 'definition' },
          { path: 'sprite/100100/d_r.plist', role: 'atlas' },
          { path: 'sprite/100100/d_r.png', role: 'texture' },
        ],
      },
    },
  },
  {
    version: 1,
    universe: 'a',
    kind: 'scenario',
    entries: {
      'a:scenario/310241@zh': {
        parts: [{ path: 'scenario/310241.zh.json', role: 'script' }],
      },
    },
  },
  {
    version: 1,
    universe: 'b',
    kind: 'model3d',
    entries: {
      'b:model3d/100101': {
        parts: [
          { path: '3d/chara_100101/model.fbx.gz', role: 'model', encoding: 'gzip' },
          { path: '3d/chara_100101/ctrl.png', role: 'texture' },
        ],
      },
    },
  },
];
