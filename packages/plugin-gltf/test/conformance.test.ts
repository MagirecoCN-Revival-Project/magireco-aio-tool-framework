import { parseRef } from '@aio/core';
import { MODEL3D_SHOW } from '@aio/capability';
import { runCapabilityConformance } from '@aio/conformance';
import { StaticProvider } from '@aio/resource';
import { createGltfPlugin } from '../src/index.js';

const GLTF = JSON.stringify({
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'root', mesh: 0 }],
  meshes: [{ name: 'body', primitives: [{ attributes: { POSITION: 0 } }] }],
  buffers: [{ uri: 'scene.bin', byteLength: 4 }],
  animations: [{ name: 'idle', channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }] }],
});

const resources = (): StaticProvider =>
  new StaticProvider({
    entries: {
      'b:model3d/100101': [
        { role: 'model', path: '3d/100101/scene.gltf', url: 'https://assets.example/scene.gltf' },
        // 外部依赖按 uri 同名登记 role——插件据此解析，不去拼 URL。
        { role: 'scene.bin', path: '3d/100101/scene.bin', url: 'https://assets.example/scene.bin' },
      ],
    },
    fetchImpl: async () => new Response(GLTF),
  });

runCapabilityConformance({
  name: 'plugin-gltf（从零实现，无上游）',
  contract: MODEL3D_SHOW,
  // 舞台注入为 null；真跑 WebGL 的舞台必须传 usesWebGL: true。
  createPlugin: () => createGltfPlugin({ createStage: () => null, usesWebGL: false }),
  createResources: resources,
  present: parseRef('b:model3d/100101'),
  absent: parseRef('b:model3d/999999'),
});
