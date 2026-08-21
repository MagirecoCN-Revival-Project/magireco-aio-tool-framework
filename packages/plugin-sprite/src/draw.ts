import { regionInAtlas, type AtlasFrame } from './atlas.js';
import type { Affine } from './pose.js';

/**
 * 摆放算术：骨骼变换 → 屏幕矩阵，图集帧 → 一次 `drawImage` 的参数。
 *
 * 单独成一个模块是因为它**没有一行 DOM**，于是「贴图摆在哪」这件事能在 node 上
 * 逐条验。舞台只负责把算好的数喂给 canvas。
 */

export const IDENTITY_AFFINE: Affine = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

/** 先 `n` 后 `m`。canvas 口径：x' = a·x + c·y + tx，y' = b·x + d·y + ty。 */
export function multiply(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    tx: m.a * n.tx + m.c * n.ty + m.tx,
    ty: m.b * n.tx + m.d * n.ty + m.ty,
  };
}

/**
 * 骨骼的世界矩阵 → 屏幕矩阵。
 *
 * 导出数据的 y 向上，canvas 的 y 向下，所以夹一层镜像：`M · T · M`。
 * 只翻平移（早先那种写法）在方块上看不出来，一旦画贴图就会发现旋转方向反了。
 *
 * 结果里局部坐标系是 **y 向下**的，正好与 `drawImage` 的口径一致——
 * 否则每张贴图都是倒着画上去的。
 */
export function toScreen(world: Affine, cx: number, cy: number): Affine {
  return {
    a: world.a,
    b: -world.b,
    c: -world.c,
    d: world.d,
    tx: cx + world.tx,
    ty: cy - world.ty,
  };
}

/** 一次 `drawImage(img, sx,sy,sw,sh, dx,dy,dw,dh)` 的全部参数，外加它自己的附加变换。 */
export interface FramePlacement {
  /** 在骨骼的屏幕矩阵之后再乘的变换（裁剪偏移）。 */
  readonly matrix: Affine;
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
}

/**
 * 把一帧图集摆到骨骼上。
 *
 * 目的矩形以骨骼原点为中心，再按 `offset` 挪回裁剪掉的透明边——不挪的话，
 * 裁过的图会整体往一边缩，看起来像是骨骼位置错了。`offset` 是 y 向上的
 * cocos 口径，而这里的局部系 y 向下，所以 y 取反。
 *
 * ## 🚧 `rotated` 的帧返回 null，不猜
 *
 * 打包器把竖长图转 90° 塞进图集，但**转的是哪个方向**取决于打包器，
 * 而两个方向都会画出一张「看着像那么回事」的图：错的那个是上下颠倒或镜像的
 * 零件，不报错。这正是本仓库不接受的那类错误（铁律 2 同源）。
 *
 * 手上没有任何真实图集可对（素材一个字节都不进这棵树，铁律 9），所以这里
 * **返回 null 让调用方知道自己不会摆**，而不是挑一个方向蒙对一半。
 *
 * 证伪/补全方式：拿一张真实图集，找一个 `rotated=true` 的帧，比对它在游戏里的
 * 朝向；确定方向后这里补一次 90° 旋转（`{a:0,b:∓1,c:±1,d:0}`）并补一条判据，
 * 五行就够。
 */
export function placeFrame(frame: AtlasFrame): FramePlacement | null {
  if (frame.rotated) return null;

  const region = regionInAtlas(frame);
  return {
    matrix: { a: 1, b: 0, c: 0, d: 1, tx: frame.offsetX, ty: -frame.offsetY },
    sx: region.x,
    sy: region.y,
    sw: region.width,
    sh: region.height,
    dx: -frame.width / 2,
    dy: -frame.height / 2,
    dw: frame.width,
    dh: frame.height,
  };
}
