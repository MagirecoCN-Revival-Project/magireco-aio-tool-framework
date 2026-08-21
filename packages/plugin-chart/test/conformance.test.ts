import { parseRef } from '@aio/core';
import { CHART_HEIGHT } from '@aio/capability';
import { runCapabilityConformance } from '@aio/conformance';
import { StaticProvider } from '@aio/resource';
import { createChartPlugin } from '../src/index.js';

/** 档案是**合成的**（铁律 9）。契约管「能被怎么用」，与数据内容无关。 */

const PROFILE = JSON.stringify({ name: '甲角色', heightCm: 158 });

const resources = (): StaticProvider =>
  new StaticProvider({
    entries: {
      'a:character/1001': [
        { role: 'profile', path: '1001.json', url: 'https://assets.example/1001.json' },
      ],
    },
    fetchImpl: async () => new Response(PROFILE),
  });

runCapabilityConformance({
  name: 'plugin-chart（从零实现，无上游）',
  contract: CHART_HEIGHT,
  createPlugin: () => createChartPlugin({ createStage: () => null }),
  createResources: resources,
  present: parseRef('a:character/1001'),
  absent: parseRef('a:character/999999'),
});
