import type { Plugin } from '@aio/kernel';
import { createAdvPlugin, createDomStage } from '@aio/plugin-adv';
import { createGltfPlugin } from '@aio/plugin-gltf';
import { createCanvas2dStage, createSpritePlugin } from '@aio/plugin-sprite';
import type { CatalogEntry } from '../kernel/station';

/**
 * 工作站装的插件。
 *
 * **三个都是真实现，一个占位都不剩了。** 各自的解析、时间轴与生命周期都跑
 * `packages/` 里那份生产代码；缺的只是「画得多好看」——贴图与真渲染要等
 * 资源面（Phase 2）与各自的 WebGL 舞台。
 *
 * ## 隔离级别为什么全是 inline
 *
 * 契约（`contracts/*.source.json`）里那几个上游查看器是 `iframe`，因为它们靠
 * `window.cc`、`window.Live2DCubismCore` 这类全局活着，必须独占 realm。
 * 而这里装的两个真实现**没有那些运行时**——它们从零写，只用平台原语，
 * 所以同 realm 共存没有问题。这正是「不碰上游」换来的额外好处：
 * 不继承别人的全局污染，也就不必付隔离的代价。
 *
 * ## 舞台工厂都要能返回 null
 *
 * `SurfaceTarget.container` 的类型是 `unknown`，约定写明「测试环境可为 null」。
 * 早先的占位插件直接当 `HTMLElement` 用，被能力一致性套件一次抓出 13 处失败
 * （`Cannot read properties of null`）——**渲染是可选的，契约行为不是**：
 * 资源解析、生命周期、进度回流在没有 DOM 的环境里同样必须成立，
 * 否则它们既不能在 node 上测，也过不了 SSR 预检。
 * 下面三个真实现的舞台工厂都遵循这条：拿不到 DOM 就返回 null，引擎照常跑。
 */

/**
 * 3D 模型查看器——**已经是真实现了**。
 *
 * `@aio/plugin-gltf` 解析 glTF 2.0：动画清单、场景节点、外部依赖。
 * 舞台注入为 null（真渲染要等接一个 WebGL 舞台），所以这里 `usesWebGL: false`
 * ——多声明一个不存在的占用会让治理器白白挂起别的查看器。
 *
 * 它取代的是那个包上游 `example-model-viewer` 的适配器 `@aio/plugin-model-3d`：
 * 那个适配器仍在仓库里、仍过同一套一致性判据，只是它依赖的上游子包装不上
 * （见 ACTIVE.md 阻塞项）。**同一个能力有两个实现，宿主选装哪个都行**
 * ——这正是 ADR 0002 要的形状。
 */
function model3d(): Plugin {
  return createGltfPlugin({ createStage: () => null, usesWebGL: false });
}

/**
 * 战斗精灵——**已经是真实现了，不是占位**。
 *
 * `@aio/plugin-sprite` 负责解析骨骼与推帧，`createCanvas2dStage` 把算出来的
 * 骨骼变换真的画在 canvas 上。骨骼数据是合成的（铁律 9：素材不进这棵树），
 * 但解析、插值、循环、动作切换走的都是生产路径。
 *
 * canvas 2D 不占 WebGL 上下文，所以 `usesWebGL: false`——多声明一个不存在的
 * 占用会让治理器白白挂起别的查看器。
 */
function spriteViewer(): Plugin {
  return createSpritePlugin({
    createStage: (container) => createCanvas2dStage(container, { width: 320, height: 320 }),
    usesWebGL: false,
    fps: 30,
  });
}

/**
 * ADV 播放器——**已经是真实现了，不是占位**。
 *
 * `@aio/plugin-adv` 负责解析 worksheet 与推进时间轴，`createDomStage` 把
 * 说话人与台词真的画成对话框。剧本是合成的（铁律 9），但解析、推进、进度回流
 * 走的都是生产路径。
 *
 * DOM 舞台不占 WebGL 上下文，所以 `usesWebGL: false`。用 DOM 而不是 canvas 是
 * 因为 ADV 的主体是文本：文字要可选中、可复制、能被读屏念、跟随系统字号。
 */
function advPlayer(): Plugin {
  return createAdvPlugin({
    createStage: (container) => createDomStage(container),
    usesWebGL: false,
    autoAdvanceMs: 1800,
  });
}

export const PLUGIN_CATALOG: readonly CatalogEntry[] = [
  {
    id: 'model-3d',
    title: '3D 模型查看器',
    note: '真实现：@aio/plugin-gltf。glTF 2.0 真解析（动画清单、外部依赖）',
    create: model3d,
  },
  {
    id: 'sprite-viewer',
    title: '战斗精灵',
    note: '真实现：@aio/plugin-sprite + canvas2d 舞台。骨骼真解析、真插值、真画',
    create: spriteViewer,
  },
  {
    id: 'adv-player',
    title: 'ADV 播放器',
    note: '真实现：@aio/plugin-adv + DOM 舞台。worksheet 真解析、时间轴真推进',
    create: advPlayer,
  },
];
