import type { ScenarioCommand } from './scenario.js';
import type { Stage } from './engine.js';

/**
 * 一个**真的会画东西**的 ADV 舞台：纯 DOM。
 *
 * 它画对话框——说话人、台词、当前指令，随引擎推进逐行更新。**不画立绘与背景**：
 * 那些要等资源面（Phase 2）把图送上来。这不是占位，是有边界的实现：
 * 台词链路是完整的，缺的是图。
 *
 * ## 为什么是 DOM 而不是 canvas
 *
 * ADV 的主体是**文本**。用 DOM 意味着：文字可选中、可复制、能被读屏软件念、
 * 跟随系统字号——canvas 一样都做不到。而且 DOM 舞台**不占 WebGL 上下文**，
 * 装它的插件应当传 `usesWebGL: false`。
 *
 * ## 为什么不在这里 import DOM 类型
 *
 * 这个包要能在 node 上被 import（一致性套件就在 node 上跑）。所以容器一律
 * 鸭子判定，拿不到就返回 null，由调用方决定怎么降级。
 */

export interface DomStageOptions {
  /** 类名前缀，供宿主写样式。 */
  readonly prefix?: string;
}

interface ElementLike {
  className: string;
  textContent: string | null;
  append(...nodes: unknown[]): void;
  remove(): void;
}

function makeEl(tag: string, className: string): ElementLike {
  const el = document.createElement(tag) as unknown as ElementLike;
  el.className = className;
  return el;
}

/** 拿不到 DOM 就返回 null——插件据此走「不画但照常推进并回话」那条路。 */
export function createDomStage(
  container: unknown,
  options: DomStageOptions = {},
): Stage | null {
  if (
    typeof document === 'undefined' ||
    typeof container !== 'object' ||
    container === null ||
    typeof (container as { append?: unknown }).append !== 'function'
  ) {
    return null;
  }

  const p = options.prefix ?? 'adv';
  const root = makeEl('div', `${p}-stage`);
  const speaker = makeEl('div', `${p}-speaker`);
  const text = makeEl('p', `${p}-text`);
  const meta = makeEl('div', `${p}-meta`);
  root.append(speaker, text, meta);
  (container as { append(node: unknown): void }).append(root);

  return {
    show(command: ScenarioCommand): void {
      // 没有说话人的指令（背景切换、演出）也要显示，否则用户会觉得卡住了。
      speaker.textContent = command.speaker ?? '';
      text.textContent = command.text ?? '（演出指令）';
      const bits = [`#${command.index}`, command.action];
      if (command.assetId !== undefined) bits.push(command.assetId);
      meta.textContent = bits.join(' · ');
    },

    dispose(): void {
      root.remove();
    },
  };
}
