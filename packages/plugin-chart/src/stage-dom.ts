import { formatRef, type ResourceRef } from '@aio/core';
import type { ChartLayout } from './chart.js';

/**
 * 身高对比图的舞台：纯 DOM。
 *
 * ## 为什么是 DOM 而不是 canvas
 *
 * 一张身高图上真正要传达的是**数字与名字**。DOM 意味着数字可选中、可复制、
 * 能被读屏软件念、跟随系统字号；柱子用 `height: %` 就够，不需要一个像素缓冲。
 * canvas 画出来的图对读屏软件是一块空白。
 *
 * DOM 舞台**不占 WebGL 上下文**，装它的插件应当传 `usesWebGL: false`。
 *
 * ## 为什么不在这里 import DOM 类型
 *
 * 这个包要能在 node 上被 import（一致性套件就在 node 上跑）。所以容器一律
 * 鸭子判定，拿不到就返回 null，由调用方决定怎么降级。
 */

export interface Stage {
  draw(layout: ChartLayout): void;
  dispose(): void;
}

export interface DomStageOptions {
  /** 类名前缀，供宿主写样式。 */
  readonly prefix?: string;
  /** 点了某一条。插件据此发 `entity.focused`。 */
  readonly onPick?: (ref: ResourceRef) => void;
}

interface ElementLike {
  className: string;
  textContent: string | null;
  title: string;
  readonly style: Record<string, string>;
  readonly dataset: Record<string, string>;
  append(...nodes: unknown[]): void;
  replaceChildren(...nodes: unknown[]): void;
  remove(): void;
  addEventListener(type: string, fn: (ev: unknown) => void): void;
  setAttribute(name: string, value: string): void;
}

function makeEl(tag: string, className: string): ElementLike {
  const el = document.createElement(tag) as unknown as ElementLike;
  el.className = className;
  return el;
}

/** 拿不到 DOM 就返回 null——插件据此走「不画但照常回话」那条路。 */
export function createDomStage(container: unknown, options: DomStageOptions = {}): Stage | null {
  if (
    typeof document === 'undefined' ||
    typeof container !== 'object' ||
    container === null ||
    typeof (container as { append?: unknown }).append !== 'function'
  ) {
    return null;
  }

  const p = options.prefix ?? 'chart';
  const root = makeEl('div', `${p}-stage`);
  const plot = makeEl('div', `${p}-plot`);
  const scale = makeEl('div', `${p}-scale`);
  const note = makeEl('p', `${p}-note`);
  root.append(scale, plot, note);
  (container as { append(node: unknown): void }).append(root);

  return {
    draw(layout: ChartLayout): void {
      const ticks = layout.ticks.map((t) => {
        const el = makeEl('div', `${p}-tick`);
        el.style['bottom'] = `${(t.ratio * 100).toFixed(2)}%`;
        el.textContent = `${t.cm}`;
        return el;
      });
      scale.replaceChildren(...ticks);

      const bars = layout.bars.map((bar) => {
        const col = makeEl('button', `${p}-bar${bar.focus ? ` ${p}-bar-focus` : ''}`);
        // 用 button 而不是 div：键盘能 Tab 到、回车能触发，读屏软件会念成可点。
        col.setAttribute('type', 'button');
        col.style['height'] = `${(bar.ratio * 100).toFixed(2)}%`;
        // 数字进 title 与文本，两处都要——只放 title 的话读屏与复制都拿不到。
        col.title = `${bar.label} ${bar.heightCm} cm`;
        col.textContent = `${bar.label} ${bar.heightCm}`;
        col.dataset['ref'] = formatRef(bar.ref);
        if (options.onPick !== undefined) {
          col.addEventListener('click', () => options.onPick?.(bar.ref));
        }
        return col;
      });
      plot.replaceChildren(...bars);

      // 没登记身高的角色不画柱子，但**必须说出来**：悄悄消失会让人以为
      // 那个角色不在名单里，而它其实在，只是没有数据。
      note.textContent =
        layout.missing.length === 0
          ? ''
          : `${layout.missing.length} 个角色没有登记身高：${layout.missing
              .map((r) => formatRef(r))
              .join('、')}`;
    },

    dispose(): void {
      root.remove();
    },
  };
}
