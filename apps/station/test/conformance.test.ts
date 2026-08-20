import { parseRef } from '@aio/core';
import { ADV_PLAY, MODEL3D_SHOW, SPRITE_SHOW } from '@aio/capability';
import { runCapabilityConformance } from '@aio/conformance';
import { PLUGIN_CATALOG } from '../src/station/plugins';
import { createDemoResources } from '../src/station/data';

/**
 * 工作站装的三个插件都要过一致性套件。
 *
 * `sprite-viewer` 现在是**真实现**（`@aio/plugin-sprite` + canvas2d 舞台），
 * 另两个仍是占位。两者跑的是同一套判据，而且用的是站点运行时那个 provider
 * 工厂——这正是「换实现宿主零改动」的验收：换掉一个插件的内部，套件不动、
 * 宿主不动、其余插件不动。
 */

// 与 station 运行时用的是**同一个** provider 工厂——测试里换一套数据的话，
// 测的就不是站点实际跑的那套了。
const resources = createDemoResources;

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
  name: 'station 真实现 sprite（plugin-sprite + canvas2d）',
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
