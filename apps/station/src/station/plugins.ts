import { formatRef } from '@aio/core';
import type { Intent } from '@aio/core';
import type { Plugin, PluginHost, PluginInstance, SurfaceTarget } from '@aio/kernel';
import { createAdvPlugin, createDomStage } from '@aio/plugin-adv';
import { createCanvas2dStage, createSpritePlugin } from '@aio/plugin-sprite';
import type { CatalogEntry } from '../kernel/station';

/**
 * 工作站装的插件。
 *
 * **`sprite-viewer` 与 `adv-player` 已经是真实现**（`@aio/plugin-sprite` +
 * canvas2d 舞台、`@aio/plugin-adv` + DOM 舞台）。只剩 `model-3d` 是占位，
 * 因为它唯一的真实现还依赖一个装不上的上游包（见 ACTIVE.md 阻塞项）。
 *
 * ## 隔离级别为什么全是 inline
 *
 * 契约（`contracts/*.source.json`）里那几个上游查看器是 `iframe`，因为它们靠
 * `window.cc`、`window.Live2DCubismCore` 这类全局活着，必须独占 realm。
 * 而这里装的两个真实现**没有那些运行时**——它们从零写，只用平台原语，
 * 所以同 realm 共存没有问题。这正是「不碰上游」换来的额外好处：
 * 不继承别人的全局污染，也就不必付隔离的代价。
 *
 * ## 为什么下面还留着 DOM 判定
 *
 * `SurfaceTarget.container` 的类型是 `unknown`，约定写明「测试环境可为 null」。
 * 占位插件最初直接当 `HTMLElement` 用，被能力一致性套件一次抓出 13 处失败
 * （`Cannot read properties of null`）——**渲染是可选的，契约行为不是**：
 * 资源解析、生命周期、进度回流在没有 DOM 的环境里同样必须成立，
 * 否则它们既不能在 node 上测，也过不了 SSR 预检。
 * 两个真实现的舞台工厂遵循同一条约定：拿不到 DOM 就返回 null。
 */

/** 鸭子判定，不依赖 DOM 全局——node 环境下 `HTMLElement` 根本不存在。 */
function asElement(container: unknown): HTMLElement | null {
  return typeof container === 'object' &&
    container !== null &&
    typeof (container as HTMLElement).replaceChildren === 'function'
    ? (container as HTMLElement)
    : null;
}

/** 没有 DOM 时返回 null，调用方据此跳过渲染。 */
function panel(target: SurfaceTarget, title: string, ref: string): HTMLElement | null {
  const root = asElement(target.container);
  if (root === null) return null;

  root.replaceChildren();
  const head = document.createElement('div');
  head.className = 'sf-head';
  const h = document.createElement('span');
  h.className = 'sf-title';
  h.textContent = title;
  const code = document.createElement('code');
  code.textContent = ref;
  head.append(h, code);
  const body = document.createElement('div');
  body.className = 'sf-body-inner';
  root.append(head, body);
  return body;
}

/**
 * 解析资源并（在有 DOM 时）画出来。
 *
 * **解析本身无论有没有 DOM 都要做**：它是契约行为，也是插件只经
 * `host.resources` 拿资源这条铁律的落点（铁律 3）。
 */
function showParts(body: HTMLElement | null, host: PluginHost, intent: Intent): void {
  let lines: string[];
  try {
    lines = host.resources
      .resolve(intent.ref)
      .parts.map((part) => `${part.role} → ${part.candidates[0]?.url ?? '(无可用源)'}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    host.log('warn', `解析 ${formatRef(intent.ref)} 失败：${reason}`);
    lines = [reason];
  }

  if (body === null) return;
  const list = document.createElement('ul');
  list.className = 'parts';
  for (const text of lines) {
    const li = document.createElement('li');
    li.textContent = text;
    list.append(li);
  }
  body.append(list);
}

/**
 * 只渲染、没有内部状态的插件实例。
 *
 * `update` 不是可选的锦上添花：内核在同一插件已有 surface 时会**就地 update**
 * 而不是新开一个，没有它，连点五次入口会开出五个实例——五个都占着 WebGL
 * 上下文。能力一致性套件有一条判据专门盯这件事。
 */
function renderOnly(
  target: SurfaceTarget,
  host: PluginHost,
  title: string,
): PluginInstance {
  const render = (i: Intent): void => {
    showParts(panel(target, title, formatRef(i.ref)), host, i);
  };
  return {
    suspend() {},
    resume() {},
    dispose() {},
    update(next) {
      render(next);
    },
  };
}

function model3d(): Plugin {
  return {
    manifest: {
      id: 'model-3d',
      version: '0.1.0',
      title: '3D 模型查看器',
      isolation: 'inline',
      usesWebGL: true,
      provides: [{ id: 'model3d.show', accepts: ['model3d', 'character'], title: '查看 3D 模型' }],
      needs: ['model3d'],
    },
    async mount(target, intent, host) {
      showParts(panel(target, '3D 模型查看器', formatRef(intent.ref)), host, intent);
      return renderOnly(target, host, '3D 模型查看器');
    },
  };
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
    note: 'example-model-viewer：three.js 是 ESM，可与宿主同 realm（契约 isolation=inline）',
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
