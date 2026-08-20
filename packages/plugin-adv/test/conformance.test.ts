import { parseRef } from '@aio/core';
import { ADV_PLAY } from '@aio/capability';
import { runCapabilityConformance } from '@aio/conformance';
import { StaticProvider } from '@aio/resource';
import { createAdvPlugin } from '../src/index.js';

/**
 * `adv.play` 的第二个实现跑同一套判据。
 *
 * 第一个是 `packages/conformance/test/reference.test.ts` 里那个最小参考实现，
 * 这个是带真解析器与真播放引擎的。两边都过，说明契约测的是契约。
 *
 * 剧本是**合成的**，不是游戏原文（铁律 9）。契约管「能被怎么用」，
 * 与内容无关，所以合成数据完全够用。
 */

const SCRIPT = JSON.stringify({
  sheetList: [
    {
      headerRow: { cellList: ['ActionType', 'Name', 'Comment', 'AssetID'] },
      contentRowList: [
        { cellList: ['BgChange', '', '', 'bg-01'] },
        { cellList: ['Talk', '甲', '合成台词一', 'chara-a'] },
        { cellList: ['// 注释行', '', '', ''] },
        { cellList: ['Talk', '乙', '合成台词二', 'chara-b'] },
        { cellList: ['Talk', '甲', '合成台词三', ''] },
      ],
    },
  ],
});

const resources = (): StaticProvider =>
  new StaticProvider({
    entries: {
      'a:scenario/310241@zh': [
        { role: 'script', path: '310241/zh.json', url: 'https://assets.example/310241/zh.json' },
      ],
    },
    fetchImpl: async () => new Response(SCRIPT),
  });

runCapabilityConformance({
  name: 'plugin-adv（从零实现，无上游）',
  contract: ADV_PLAY,
  // 舞台注入为 null：node 里没有 DOM，引擎照常跑时间轴。
  // usesWebGL 由舞台决定而不是由能力决定——DOM 舞台不占，Pixi 舞台占。
  createPlugin: () => createAdvPlugin({ createStage: () => null, usesWebGL: false, autoAdvanceMs: 300 }),
  createResources: resources,
  present: parseRef('a:scenario/310241@zh'),
  absent: parseRef('a:scenario/999999'),
});
