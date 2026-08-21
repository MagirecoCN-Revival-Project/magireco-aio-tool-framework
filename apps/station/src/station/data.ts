import type { RegistryData } from '@aio/registry';
import { StaticProvider } from '@aio/resource';
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


/**
 * 骨架期的合成骨骼——**不是游戏素材**（铁律 9）。
 *
 * 三根骨骼、两个动作，够 canvas2d 舞台真的动起来：`idle` 循环上下浮动，
 * `wave` 不循环、播完停住。这样「真实现 + 真舞台」在 station 里是可见的，
 * 而不是又一个占位方块。
 */
const kf = (fi: number, x: number, y: number, cX = 1) => ({ fi, x, y, cX, cY: cX, kX: 0, kY: 0 });

export const DEMO_SPRITE_ARMATURE = {
  armature_data: [{ name: 'demo_armature', bone_data: [] }],
  animation_data: [
    {
      name: 'demo_armature',
      mov_data: [
        {
          name: 'idle',
          dr: 40,
          lp: true,
          sc: 1,
          mov_bone_data: [
            { name: 'head', frame_data: [kf(0, 0, 40), kf(20, 0, 55), kf(39, 0, 40)] },
            { name: 'body', frame_data: [kf(0, 0, 0), kf(20, 0, 6), kf(39, 0, 0)] },
            { name: 'arm', frame_data: [kf(0, -30, 10), kf(20, -34, 16), kf(39, -30, 10)] },
          ],
        },
        {
          name: 'wave',
          dr: 30,
          lp: false,
          sc: 1,
          mov_bone_data: [
            { name: 'head', frame_data: [kf(0, 0, 40), kf(29, 0, 40)] },
            { name: 'body', frame_data: [kf(0, 0, 0), kf(29, 0, 0)] },
            { name: 'arm', frame_data: [kf(0, -30, 10), kf(15, 40, 60, 1.4), kf(29, -30, 10)] },
          ],
        },
      ],
    },
  ],
  texture_data: [],
};

/**
 * 骨架期的合成剧本——**不是游戏原文**（铁律 9）。
 *
 * 表头照真实格式（`ActionType / Name / Comment / AssetID`），并且**故意打乱列序**
 * 又插了一行注释：解析器是按表头名建索引的，这两样正是它该扛住的东西。
 */
export const DEMO_SCENARIO_WORKSHEET = {
  sheetList: [
    {
      // 列序与常见顺序不同，用来证明「按表头名解析，不依赖列序」不是空话。
      headerRow: { cellList: ['Name', 'AssetID', 'ActionType', 'Comment'] },
      contentRowList: [
        { cellList: ['', 'bg_demo', 'BgChange', ''] },
        { cellList: ['甲', 'chara_a', 'Talk', '这是合成台词，不是游戏原文。'] },
        { cellList: ['', '', '// 注释行，应当被跳过', ''] },
        { cellList: ['乙', 'chara_b', 'Talk', '解析器按表头名取字段，所以列序换了也认得。'] },
        { cellList: ['甲', 'chara_a', 'Talk', '注释行不会变成一句台词。'] },
        { cellList: ['', '', 'FadeOut', ''] },
      ],
    },
  ],
};

/**
 * 骨架期的合成 glTF——**不是游戏模型**（铁律 9）。
 *
 * 一个节点、一个网格、两条动画（其中一条**故意不给 name**，用来验
 * 「规范允许无名动画」那条路径），外加一份外部 buffer——它在下面的清单里
 * 按 uri 同名登记了 role，所以插件能解析到它而不必去拼 URL。
 */
export const DEMO_GLTF = {
  asset: { version: '2.0', generator: 'AIO 合成' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'root', mesh: 0 }],
  meshes: [{ name: 'body', primitives: [{ attributes: { POSITION: 0 } }] }],
  buffers: [{ uri: 'scene.bin', byteLength: 4 }],
  animations: [
    { name: 'idle', channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }], samplers: [] },
    { channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }], samplers: [] },
  ],
};

const dataUrl = (value: unknown): string =>
  `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(value))}`;

/**
 * 骨架期的资源提供者。
 *
 * 用 `StaticProvider` 而不是 `ManifestCdnProvider`：资源面（COS + EdgeOne）
 * 还没搭起来，而 `StaticProvider` 正是为「离线包／本地目录／测试造数据」
 * 这类场景存在的实现之一。**换 provider 插件零改动**——这正是 ADR 0002
 * 第一层那条判据在实际用途上的兑现，不是演示。
 *
 * 精灵那条给的是 `data:` URL，所以真插件真的能 fetch 到、真的能解析、
 * 真的能画。其余两条仍指向占位地址：那两个插件只调 `resolve()` 看看路由，
 * 不 fetch。
 */
export function createDemoResources(): StaticProvider {
  return new StaticProvider({
    entries: {
      'a:sprite/100100/d_r': [
        { role: 'definition', path: 'sprite/100100/d_r.ExportJson', url: dataUrl(DEMO_SPRITE_ARMATURE) },
      ],
      'a:scenario/310241@zh': [
        { role: 'script', path: 'scenario/310241.zh.json', url: dataUrl(DEMO_SCENARIO_WORKSHEET) },
      ],
      'b:model3d/100101': [
        { role: 'model', path: '3d/chara_100101/scene.gltf', url: dataUrl(DEMO_GLTF) },
        // 外部依赖按 uri 同名登记 role——插件据此解析，不去拼 URL（铁律 3）。
        { role: 'scene.bin', path: '3d/chara_100101/scene.bin', url: 'https://assets.example.invalid/3d/chara_100101/scene.bin' },
      ],
    },
  });
}
