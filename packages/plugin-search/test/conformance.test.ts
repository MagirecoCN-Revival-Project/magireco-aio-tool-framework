import { parseRef } from '@aio/core';
import { SEARCH_QUERY } from '@aio/capability';
import { runCapabilityConformance } from '@aio/conformance';
import { StaticProvider } from '@aio/resource';
import { createSearchPlugin } from '../src/index.js';

const CATALOG = JSON.stringify([
  { ref: 'a:character/1001', zh: '甲角色', jp: 'こうきゃら', roman: 'Kou Kyara' },
  { zh: '乙角色', roman: 'Otsu Kyara' },
]);

const resources = (): StaticProvider =>
  new StaticProvider({
    entries: {
      'a:character/1001': [
        { role: 'catalog', path: 'catalog.json', url: 'https://assets.example/catalog.json' },
      ],
    },
    fetchImpl: async () => new Response(CATALOG),
  });

runCapabilityConformance({
  name: 'plugin-search（从零实现，无上游）',
  contract: SEARCH_QUERY,
  createPlugin: () => createSearchPlugin({ createStage: () => null }),
  createResources: resources,
  present: parseRef('a:character/1001'),
  absent: parseRef('a:character/999999'),
});
