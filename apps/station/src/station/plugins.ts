import { formatRef } from '@aio/core';
import type { Intent } from '@aio/core';
import type { Plugin, PluginHost, PluginInstance, SurfaceTarget } from '@aio/kernel';
import type { CatalogEntry } from '../kernel/station';

/**
 * 骨架期的占位插件。
 *
 * **真的**：manifest、能力声明、生命周期、事件总线、资源解析——全部走
 * `packages/` 里那份生产代码，与 demo 宿主用的是同一条路径。
 *
 * **占位的**：`mount()` 里的渲染。它们画的是占位面板，不真的跑 three.js /
 * cocos2d / Cubism。把 `mount()` 换成真正的查看器，这些就是成品——
 * 怎么换见 `docs/VIEWER-REFACTOR.md`（结论是四个查看器一个都不用重写）。
 *
 * ## 隔离级别为什么这里全是 inline
 *
 * 契约（`contracts/*.source.json`）里 `sprite-viewer` / `adv-player` /
 * `viewer-sp` 都是 `iframe`——它们靠 `window.cc`、`window.Live2DCubismCore`
 * 这类全局活着，必须独占 realm。占位版没有那些运行时，也就没有隔离的理由，
 * 所以按 inline 走。接真查看器时改用 `createIframePlugin()` 包一层，
 * **调用方一行都不用改**（demo 宿主里有一个跑通的 iframe RPC 例子）。
 *
 * ## 为什么每处都要判断有没有 DOM
 *
 * `SurfaceTarget.container` 的类型是 `unknown`，约定写明「测试环境可为 null」。
 * 这三个插件最初直接当 `HTMLElement` 用，被能力一致性套件一次抓出 13 处失败
 * （`Cannot read properties of null`）——**渲染是可选的，契约行为不是**：
 * 资源解析、生命周期、进度回流在没有 DOM 的环境里同样必须成立，
 * 否则它们既不能在 node 上测，也过不了 SSR 预检。
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

function spriteViewer(): Plugin {
  return {
    manifest: {
      id: 'sprite-viewer',
      version: '0.1.0',
      title: '战斗精灵',
      isolation: 'inline',
      usesWebGL: true,
      provides: [{ id: 'sprite.show', accepts: ['sprite', 'character'], title: '显示战斗精灵' }],
      needs: ['sprite'],
    },
    async mount(target, intent, host) {
      showParts(panel(target, '战斗精灵', formatRef(intent.ref)), host, intent);
      return renderOnly(target, host, '战斗精灵');
    },
  };
}

function advPlayer(): Plugin {
  return {
    manifest: {
      id: 'adv-player',
      version: '0.1.0',
      title: 'ADV 播放器',
      isolation: 'inline',
      usesWebGL: true,
      provides: [{ id: 'adv.play', accepts: ['scenario'], title: '实机播放剧情' }],
      needs: ['scenario'],
    },
    async mount(target, intent, host) {
      const body = panel(target, 'ADV 播放器', formatRef(intent.ref));
      showParts(body, host, intent);

      const total = 120;
      let line = typeof intent.params?.['line'] === 'number' ? intent.params['line'] : 0;

      // 有 DOM 就画字幕；没有也照样发进度——回流是契约行为，不是渲染的副产品。
      let caption: HTMLElement | null = null;
      if (body !== null) {
        caption = document.createElement('p');
        caption.className = 'adv-caption';
        body.append(caption);
      }

      let paused = false;
      const timer = setInterval(() => {
        if (paused) return;
        line = line >= total ? 0 : line + 1;
        if (caption !== null) caption.textContent = `第 ${line} / ${total} 行`;
        host.events.emit('progress', {
          surfaceId: host.surfaceId,
          ref: intent.ref,
          position: line,
          total,
        });
      }, 900);

      return {
        suspend() {
          paused = true;
        },
        resume() {
          paused = false;
        },
        dispose() {
          // 漏掉这一行，套件的「关闭之后不再发事件」当场变红。
          clearInterval(timer);
        },
        update(next) {
          const l = next.params?.['line'];
          if (typeof l === 'number') line = l;
        },
      };
    },
  };
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
    note: 'example-sprite-mirror：cocos2d 靠 window.cc 活着，接真查看器时必须换成 iframe',
    create: spriteViewer,
  },
  {
    id: 'adv-player',
    title: 'ADV 播放器',
    note: 'ExampleAdv：Cubism 挂 window.Live2DCubismCore 且 Pixi 已 pin，接真查看器时必须换成 iframe',
    create: advPlayer,
  },
];
