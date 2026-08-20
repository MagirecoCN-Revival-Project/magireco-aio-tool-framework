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
 */

function panel(target: SurfaceTarget, title: string, ref: string): HTMLElement {
  const root = target.container as HTMLElement;
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

/** 把资源解析结果画出来——证明插件确实只经 host.resources 拿资源（铁律 3）。 */
function showParts(body: HTMLElement, host: PluginHost, intent: Intent): void {
  const list = document.createElement('ul');
  list.className = 'parts';
  try {
    const resolved = host.resources.resolve(intent.ref);
    for (const part of resolved.parts) {
      const li = document.createElement('li');
      const first = part.candidates[0];
      li.textContent = `${part.role} → ${first ? first.url : '(无可用源)'}`;
      list.append(li);
    }
  } catch (err) {
    const li = document.createElement('li');
    li.className = 'warn';
    li.textContent = err instanceof Error ? err.message : String(err);
    list.append(li);
  }
  body.append(list);
}

function inert(): PluginInstance {
  return {
    suspend() {},
    resume() {},
    dispose() {},
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
      const body = panel(target, '3D 模型查看器', formatRef(intent.ref));
      showParts(body, host, intent);
      return inert();
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
      const body = panel(target, '战斗精灵', formatRef(intent.ref));
      showParts(body, host, intent);
      return inert();
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

      // 进度回流：阅读器据此高亮当前行，而它从未 import 过本插件。
      const total = 120;
      let line = typeof intent.params?.['line'] === 'number' ? intent.params['line'] : 0;
      const caption = document.createElement('p');
      caption.className = 'adv-caption';
      body.append(caption);

      const timer = setInterval(() => {
        line = line >= total ? 0 : line + 1;
        caption.textContent = `第 ${line} / ${total} 行`;
        host.events.emit('progress', {
          surfaceId: host.surfaceId,
          ref: intent.ref,
          position: line,
          total,
        });
      }, 900);

      let paused = false;
      return {
        suspend() {
          paused = true;
        },
        resume() {
          paused = false;
        },
        dispose() {
          clearInterval(timer);
        },
        update(next) {
          if (paused) return;
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
