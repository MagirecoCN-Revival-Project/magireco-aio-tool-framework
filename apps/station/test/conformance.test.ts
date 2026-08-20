import { parseRef } from '@aio/core';
import { ADV_PLAY, MODEL3D_SHOW, SPRITE_SHOW } from '@aio/capability';
import { runCapabilityConformance } from '@aio/conformance';
import { Manifest, ManifestCdnProvider, OriginPool } from '@aio/resource';
import { PLUGIN_CATALOG } from '../src/station/plugins';
import { DEMO_MANIFESTS, DEMO_ORIGINS } from '../src/station/data';

/**
 * 工作站自带的三个占位插件也要过一致性套件。
 *
 * 它们是我们自己写的，所以更该被自己的判据查一遍——「占位」不是不合规的理由：
 * 占位的是渲染内容，不是生命周期与契约。真查看器接进来时要替换的正是渲染，
 * 契约行为应当原封不动地继续成立。
 */

const resources = (): ManifestCdnProvider =>
  new ManifestCdnProvider({
    origins: new OriginPool(DEMO_ORIGINS),
    manifests: DEMO_MANIFESTS.map((doc) => Manifest.from(doc)),
  });

const create = (id: string) => () => PLUGIN_CATALOG.find((e) => e.id === id)!.create();

runCapabilityConformance({
  name: 'station 占位 model-3d',
  contract: MODEL3D_SHOW,
  createPlugin: create('model-3d'),
  createResources: resources,
  present: parseRef('b:model3d/100101'),
  absent: parseRef('b:model3d/999999'),
});

runCapabilityConformance({
  name: 'station 占位 sprite-viewer',
  contract: SPRITE_SHOW,
  createPlugin: create('sprite-viewer'),
  createResources: resources,
  present: parseRef('a:sprite/100100/d_r'),
  absent: parseRef('a:sprite/999999/d_r'),
});

runCapabilityConformance({
  name: 'station 占位 adv-player',
  contract: ADV_PLAY,
  createPlugin: create('adv-player'),
  createResources: resources,
  present: parseRef('a:scenario/310241@zh'),
  absent: parseRef('a:scenario/999999'),
});
