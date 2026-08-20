import { parseRef } from '@aio/core';
import { SPRITE_SHOW } from '@aio/capability';
import { runCapabilityConformance } from '@aio/conformance';
import { StaticProvider } from '@aio/resource';
import { createSpritePlugin } from '../src/index.js';

/**
 * `sprite.show` 跑与实现无关的能力套件。
 *
 * 骨骼数据是**合成的**（铁律 9）。契约管「能被怎么用」，与素材内容无关。
 */

const EXPORT_JSON = JSON.stringify({
  armature_data: [{ name: 'mini_000000', bone_data: [] }],
  animation_data: [
    {
      name: 'mini_000000',
      mov_data: [
        { name: 'name_r', dr: 40, lp: true, sc: 1, mov_bone_data: [] },
        { name: 'action_in', dr: 20, lp: false, sc: 1, mov_bone_data: [] },
      ],
    },
  ],
  texture_data: [],
});

const resources = (): StaticProvider =>
  new StaticProvider({
    entries: {
      'a:sprite/100100/d_r': [
        {
          role: 'definition',
          path: '100100/d_r.ExportJson',
          url: 'https://assets.example/100100/d_r.ExportJson',
        },
      ],
    },
    fetchImpl: async () => new Response(EXPORT_JSON),
  });

runCapabilityConformance({
  name: 'plugin-sprite（从零实现，无上游）',
  contract: SPRITE_SHOW,
  // 舞台注入为 null；usesWebGL 由舞台决定——canvas2d 舞台不占，WebGL 舞台占。
  createPlugin: () => createSpritePlugin({ createStage: () => null, usesWebGL: false, fps: 30 }),
  createResources: resources,
  present: parseRef('a:sprite/100100/d_r'),
  absent: parseRef('a:sprite/999999/d_r'),
});
