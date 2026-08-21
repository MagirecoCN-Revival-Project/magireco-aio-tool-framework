import type { SpriteAtlas } from './atlas.js';
import type { SpriteDoc, SpriteMovement } from './armature.js';
import { multiply, placeFrame, toScreen } from './draw.js';
import { matrixOf, worldPoseAt } from './pose.js';
import type { Stage } from './player.js';

/**
 * 一个**真的会画东西**的舞台：canvas 2D。
 *
 * 有图集与贴图时画贴图；没有时画骨骼本身（每根骨骼一个按其变换摆放的方块）。
 * 后者不是占位：骨骼变换、父子合成、动作切换、帧插值在画面上都看得见，
 * 而且它是资源还没上线（Phase 2）时唯一能跑的路径。
 *
 * ## 为什么它不占 WebGL
 *
 * canvas 2D 上下文不算 WebGL 上下文，不进内核那个 8–16 的配额。所以装它的
 * 插件应当传 `usesWebGL: false`——多声明一个不存在的 WebGL 占用，会让治理器
 * 白白挂起别的查看器。
 *
 * ## 为什么不在这里 import DOM 类型
 *
 * 这个包要能在 node 上被 import（一致性套件就在 node 上跑）。所以容器、canvas
 * 与贴图一律鸭子判定，拿不到就返回 null，由调用方决定怎么降级。
 * 真正的摆放算术在 `draw.ts` 里，那一份没有 DOM，能逐条验。
 */

export interface SpriteStageContext {
  readonly doc: SpriteDoc;
  /** 图集。null 表示这条 ref 没有图集，或者解析失败——那时退回画骨骼方块。 */
  readonly atlas: SpriteAtlas | null;
  /** 已解码的贴图（`ImageBitmap` / `HTMLImageElement`）。null 同上。 */
  readonly texture: unknown;
}

export interface Canvas2dStageOptions {
  readonly width?: number;
  readonly height?: number;
  /** 骨骼方块的边长（像素）。只在退回画骨骼时用。 */
  readonly boneSize?: number;
  readonly color?: string;
  readonly background?: string;
  /**
   * 有些东西这个舞台还画不了（目前只有 `rotated` 的图集帧，见 `draw.ts`）。
   * 它们会被**跳过**而不是蒙一个方向画上去，这里是唯一能知道跳过了什么的地方。
   * 每种原因只报一次。
   */
  readonly onSkipped?: (reason: string) => void;
}

interface Ctx2d {
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(
    image: never,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
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
  ctx2: SpriteStageContext,
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

  // 原点放画面中心：导出数据里的坐标是以骨架原点为中心的。
  const cx = width / 2;
  const cy = height / 2;

  const { doc, atlas, texture } = ctx2;
  const textured = atlas !== null && texture != null;
  const reported = new Set<string>();
  const skip = (reason: string): void => {
    if (reported.has(reason)) return;
    reported.add(reason);
    options.onSkipped?.(reason);
  };

  return {
    drawFrame(movement: SpriteMovement, frame: number): void {
      ctx.clearRect(0, 0, width, height);
      if (background !== 'transparent') {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.fillStyle = color;

      // worldPoseAt 已经按画序排好，直接顺序画就是正确的遮挡关系。
      for (const bone of worldPoseAt(doc, movement, frame)) {
        const screen = toScreen(matrixOf(bone.pose), cx, cy);

        if (textured && bone.display !== null) {
          // 查不到帧就不画，不去掉后缀再试、不换一张顶上（铁律 2 同源）。
          const found = atlas.frame(bone.display);
          if (found === null) {
            skip(`图集里没有帧 ${JSON.stringify(bone.display)}`);
            continue;
          }
          const place = placeFrame(found);
          if (place === null) {
            skip(`图集帧 ${JSON.stringify(found.name)} 是 rotated 的，本舞台还不会摆它`);
            continue;
          }
          const m = multiply(screen, place.matrix);
          ctx.save();
          ctx.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
          ctx.drawImage(
            texture as never,
            place.sx,
            place.sy,
            place.sw,
            place.sh,
            place.dx,
            place.dy,
            place.dw,
            place.dh,
          );
          ctx.restore();
          continue;
        }

        ctx.save();
        ctx.setTransform(screen.a, screen.b, screen.c, screen.d, screen.tx, screen.ty);
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

/**
 * 把贴图字节解成能喂给 `drawImage` 的东西。
 *
 * 单独放出来是因为它是**唯一**需要浏览器 API 的一步（`createImageBitmap`）。
 * 插件不直接调它——插件收一个 `decodeTexture`，所以整个包仍然能在 node 上
 * import，一致性套件照跑。环境不支持就返回 null，舞台退回画骨骼方块。
 */
export async function decodeTextureWithImageBitmap(bytes: ArrayBuffer): Promise<unknown> {
  if (typeof createImageBitmap !== 'function' || typeof Blob !== 'function') return null;
  return createImageBitmap(new Blob([bytes]));
}
