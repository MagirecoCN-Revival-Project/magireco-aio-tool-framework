import type { SpriteMovement } from './armature.js';
import { poseAt } from './pose.js';
import type { Stage } from './player.js';

/**
 * 一个**真的会画东西**的舞台：canvas 2D。
 *
 * 它画的是骨骼本身（每根骨骼一个按其变换摆放的方块），**不是贴图**——
 * 贴图要等资源面把图集与 plist 送上来（Phase 2）。这不是占位：骨骼变换是
 * 真算出来的，动作切换、循环、帧插值在画面上都看得见。
 *
 * ## 为什么它不占 WebGL
 *
 * canvas 2D 上下文不算 WebGL 上下文，不进内核那个 8–16 的配额。所以装它的
 * 插件应当传 `usesWebGL: false`——多声明一个不存在的 WebGL 占用，会让治理器
 * 白白挂起别的查看器。
 *
 * ## 为什么不在这里 import DOM 类型
 *
 * 这个包要能在 node 上被 import（一致性套件就在 node 上跑）。所以容器与
 * canvas 一律鸭子判定，拿不到就返回 null，由调用方决定怎么降级。
 */

export interface Canvas2dStageOptions {
  readonly width?: number;
  readonly height?: number;
  /** 骨骼方块的边长（像素）。 */
  readonly boneSize?: number;
  readonly color?: string;
  readonly background?: string;
}

interface Ctx2d {
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillStyle: string;
}

interface CanvasLike {
  width: number;
  height: number;
  style: { width: string; height: string; display: string };
  getContext(kind: '2d'): Ctx2d | null;
  remove(): void;
}

function makeCanvas(container: unknown): CanvasLike | null {
  if (
    typeof document === 'undefined' ||
    typeof container !== 'object' ||
    container === null ||
    typeof (container as { append?: unknown }).append !== 'function'
  ) {
    return null;
  }
  const canvas = document.createElement('canvas') as unknown as CanvasLike;
  (container as { append(node: unknown): void }).append(canvas);
  return canvas;
}

/** 拿不到 DOM 就返回 null——插件据此走「不画但照常推帧」那条路。 */
export function createCanvas2dStage(
  container: unknown,
  options: Canvas2dStageOptions = {},
): Stage | null {
  const canvas = makeCanvas(container);
  if (canvas === null) return null;

  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    canvas.remove();
    return null;
  }

  const width = options.width ?? 320;
  const height = options.height ?? 320;
  const boneSize = options.boneSize ?? 6;
  const color = options.color ?? '#7aa2ff';
  const background = options.background ?? 'transparent';

  canvas.width = width;
  canvas.height = height;
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  canvas.style.display = 'block';

  return {
    drawFrame(movement: SpriteMovement, frame: number): void {
      ctx.clearRect(0, 0, width, height);
      if (background !== 'transparent') {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);
      }

      ctx.fillStyle = color;
      // 原点放画面中心：导出数据里的坐标是以骨架原点为中心的。
      const cx = width / 2;
      const cy = height / 2;

      for (const pose of poseAt(movement, frame).values()) {
        ctx.save();
        // 斜切两个分量合起来就是 cocos 的旋转表达；直接喂给仿射矩阵即可。
        ctx.setTransform(
          pose.scaleX * Math.cos(pose.skewY),
          pose.scaleX * Math.sin(pose.skewY),
          -pose.scaleY * Math.sin(pose.skewX),
          pose.scaleY * Math.cos(pose.skewX),
          cx + pose.x,
          // canvas 的 y 向下，导出数据的 y 向上——不翻的话整个动作是倒的。
          cy - pose.y,
        );
        ctx.fillRect(-boneSize / 2, -boneSize / 2, boneSize, boneSize);
        ctx.restore();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },

    dispose(): void {
      canvas.remove();
    },
  };
}
