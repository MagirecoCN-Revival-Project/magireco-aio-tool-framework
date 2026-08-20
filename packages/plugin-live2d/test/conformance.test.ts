import { parseRef } from '@aio/core';
import { LIVE2D_SHOW } from '@aio/capability';
import { runCapabilityConformance } from '@aio/conformance';
import { StaticProvider } from '@aio/resource';
import { createLive2dPlugin } from '../src/index.js';

const MODEL3 = JSON.stringify({
  Version: 3,
  Name: '合成模型',
  FileReferences: {
    Moc: 'm.moc3',
    Textures: ['textures/texture_00.png'],
    Physics: null,
    DisplayInfo: null,
    Motions: { motion_000: [{ File: 'motions/motion_000.motion3.json' }] },
    Expressions: [{ Name: 'ex_01', File: 'expressions/ex_01.exp3.json' }],
  },
  Groups: [{ Target: 'Parameter', Name: 'LipSync', Ids: ['ParamMouthOpenY'] }],
});

const resources = (): StaticProvider =>
  new StaticProvider({
    entries: {
      'a:live2d/1001': [
        { role: 'model', path: '1001/1001.model3.json', url: 'https://assets.example/1001.model3.json' },
      ],
    },
    fetchImpl: async () => new Response(MODEL3),
  });

runCapabilityConformance({
  name: 'plugin-live2d（从零实现，无上游）',
  contract: LIVE2D_SHOW,
  // 舞台注入为 null；真跑 Cubism 的舞台必须传 usesWebGL: true。
  createPlugin: () => createLive2dPlugin({ createStage: () => null, usesWebGL: false }),
  createResources: resources,
  present: parseRef('a:live2d/1001'),
  absent: parseRef('a:live2d/999999'),
});
