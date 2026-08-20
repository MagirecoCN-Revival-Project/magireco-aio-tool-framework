import { parseRef } from '@aio/core';
import { Registry } from '@aio/registry';
import { Manifest, OriginPool, ResourceClient } from '@aio/resource';
import type { Plugin, PluginInstance } from '@aio/kernel';
import { definePlugin } from '@aio/plugin-sdk';

export const registry = Registry.from({
  version: 1,
  entities: [
    {
      ref: 'a:character/1001',
      nameZh: '角色甲',
      links: {
        sprite: ['a:sprite/100100/d_r'],
        voice: ['a:voice/vo_char_1001_00_01'],
      },
    },
    { ref: 'a:character/1002', nameZh: '七海八千代', links: { sprite: ['a:sprite/100200/d_r'] } },
  ],
});

export function makeResources() {
  return new ResourceClient({
    origins: new OriginPool([{ base: 'https://assets.example/', weight: 80 }]),
    manifests: [
      Manifest.from({
        version: 1, universe: 'a', kind: 'scenario',
        entries: {
          'a:scenario/310241@zh': { parts: [{ path: '310241/zh.json', role: 'script' }] },
        },
      }),
      Manifest.from({
        version: 1, universe: 'a', kind: 'sprite',
        entries: {
          'a:sprite/100100/d_r': { parts: [{ path: 's/100100.png', role: 'texture' }] },
          'a:sprite/100200/d_r': { parts: [{ path: 's/100200.png', role: 'texture' }] },
        },
      }),
      Manifest.from({
        version: 1, universe: 'a', kind: 'character',
        entries: {
          'a:character/1001': { parts: [{ path: 'c/1001.json', role: 'profile' }] },
          'a:character/1002': { parts: [{ path: 'c/1002.json', role: 'profile' }] },
        },
      }),
    ],
  });
}

export interface Recorder {
  readonly calls: string[];
}

/** 一个最小但行为完整的假插件，记录生命周期调用。 */
export function fakePlugin(
  id: string,
  opts: {
    capability: string;
    accepts: readonly ('scenario' | 'sprite' | 'character')[];
    usesWebGL?: boolean;
    priority?: number;
    supportsUpdate?: boolean;
    onMount?: (host: import('@aio/kernel').PluginHost, intent: import('@aio/core').Intent) => void;
  },
  rec: Recorder,
): Plugin {
  return definePlugin({
    manifest: {
      id,
      version: '0.0.1',
      title: id,
      isolation: 'inline',
      ...(opts.usesWebGL === undefined ? {} : { usesWebGL: opts.usesWebGL }),
      provides: [
        {
          id: opts.capability,
          accepts: opts.accepts,
          ...(opts.priority === undefined ? {} : { priority: opts.priority }),
        },
      ],
    },
    async mount(target, intent, host) {
      rec.calls.push(`${id}:mount:${target.surfaceId}`);
      opts.onMount?.(host, intent);
      const instance: PluginInstance = {
        suspend: () => void rec.calls.push(`${id}:suspend`),
        resume: () => void rec.calls.push(`${id}:resume`),
        dispose: () => void rec.calls.push(`${id}:dispose`),
      };
      if (opts.supportsUpdate === true) {
        instance.update = (next) => void rec.calls.push(`${id}:update:${next.ref.segments.join('/')}`);
      }
      return instance;
    },
  });
}

export const refs = {
  scenario: parseRef('a:scenario/310241@zh'),
  chara1001: parseRef('a:character/1001'),
  chara1002: parseRef('a:character/1002'),
  sprite1001: parseRef('a:sprite/100100/d_r'),
  missingScenario: parseRef('a:scenario/999999@zh'),
};
