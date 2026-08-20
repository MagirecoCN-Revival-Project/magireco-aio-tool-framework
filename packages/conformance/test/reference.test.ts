import { parseRef } from '@aio/core';
import { ADV_PLAY, MODEL3D_SHOW } from '@aio/capability';
import type { Plugin } from '@aio/kernel';
import { Manifest, ManifestCdnProvider, OriginPool } from '@aio/resource';
import { runCapabilityConformance } from '../src/capability.js';

/**
 * 参考实现：**从零写的，一行上游代码都不碰。**
 *
 * 两个目的：
 *
 * 1. **证明套件不是照着某个适配器写的。** 如果判据只有 `plugin-model-3d`
 *    过得了，那它测的是那个实现，不是契约。
 * 2. **证明契约能被独立满足。** 这是「不改上游」那条路的技术前提：
 *    上游若愿意接，它是契约的又一个实现；不接，这套系统照样可用，
 *    也就不存在「必须去动别人仓库」带来的越界与许可证风险。
 *
 * 它们当然不画东西——契约管的是「能被怎么用」，不是「画成什么样」。
 */

function resources(kind: 'model3d' | 'scenario', ref: string, path: string): ManifestCdnProvider {
  return new ManifestCdnProvider({
    origins: new OriginPool([{ base: 'https://assets.example/', weight: 1 }]),
    manifests: [
      Manifest.from({
        version: 1,
        universe: kind === 'model3d' ? 'b' : 'a',
        kind,
        entries: { [ref]: { parts: [{ path, role: 'main' }] } },
      }),
    ],
  });
}

/** 最小的 model3d.show 实现。 */
function referenceModel3d(): Plugin {
  return {
    manifest: {
      id: 'reference-model-3d',
      version: '0.0.0',
      title: '参考 3D 实现',
      isolation: 'inline',
      usesWebGL: MODEL3D_SHOW.usesWebGL,
      provides: [{ id: MODEL3D_SHOW.id, accepts: [...MODEL3D_SHOW.accepts], title: MODEL3D_SHOW.title }],
    },
    async mount(_target, intent, host) {
      // 资源必须经 host.resources 拿（铁律 3）。解析不到就让它抛，
      // 由内核转成挂载失败——不要吞掉再画一个空盒子。
      host.resources.resolve(intent.ref);
      return {
        suspend() {},
        resume() {},
        dispose() {},
      };
    },
  };
}

/** 最小的 adv.play 实现：契约要求发 progress，所以它真的发。 */
function referenceAdv(): Plugin {
  return {
    manifest: {
      id: 'reference-adv',
      version: '0.0.0',
      title: '参考 ADV 实现',
      isolation: 'inline',
      usesWebGL: ADV_PLAY.usesWebGL,
      provides: [{ id: ADV_PLAY.id, accepts: [...ADV_PLAY.accepts], title: ADV_PLAY.title }],
    },
    async mount(_target, intent, host) {
      host.resources.resolve(intent.ref);
      const total = 100;
      let line = typeof intent.params?.['line'] === 'number' ? intent.params['line'] : 0;

      const timer = setInterval(() => {
        line = line >= total ? 0 : line + 1;
        host.events.emit('progress', {
          surfaceId: host.surfaceId,
          ref: intent.ref,
          position: line,
          total,
        });
      }, 500);

      return {
        suspend() {},
        resume() {},
        dispose() {
          // 不清掉它，套件的「关闭之后不再发事件」当场就红——
          // 这条判据抓的正是这类泄漏。
          clearInterval(timer);
        },
      };
    },
  };
}

runCapabilityConformance({
  name: '参考实现（从零，无上游）',
  contract: MODEL3D_SHOW,
  createPlugin: referenceModel3d,
  createResources: () => resources('model3d', 'b:model3d/100101', 'chara_100101/m.fbx'),
  present: parseRef('b:model3d/100101'),
  absent: parseRef('b:model3d/999999'),
});

runCapabilityConformance({
  name: '参考实现（从零，无上游）',
  contract: ADV_PLAY,
  createPlugin: referenceAdv,
  createResources: () => resources('scenario', 'a:scenario/310241@zh', '310241/zh.json'),
  present: parseRef('a:scenario/310241@zh'),
  absent: parseRef('a:scenario/999999'),
});
