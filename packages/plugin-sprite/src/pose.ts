import type { BoneKeyframe, MovementBone, SpriteMovement } from './armature.js';

/**
 * 按帧求骨骼姿态。
 *
 * 这是「真的能画出来」与「只能列个动作名」之间那一步：导出文件里存的是
 * **关键帧**，任意一帧的姿态要插出来。放在这里而不是舞台里，是因为它是纯算术
 * ——能在 node 上逐条验，而舞台只负责把算好的变换画上去。
 */

export interface BonePose {
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly skewX: number;
  readonly skewY: number;
}

/** 不动的骨骼取这个。缩放是 1 不是 0——0 会让骨骼直接消失。 */
export const IDENTITY: BonePose = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function toPose(k: BoneKeyframe): BonePose {
  return {
    x: k.x,
    y: k.y,
    scaleX: k.scaleX,
    scaleY: k.scaleY,
    skewX: k.skewX,
    skewY: k.skewY,
  };
}

/**
 * 单根骨骼在某一帧的姿态。
 *
 * 区间外**夹住**而不是外推：外推会让骨骼在动作首尾飞出画面，
 * 而那看起来像模型坏了，不像插值越界。
 */
export function poseOfBone(bone: MovementBone, frame: number): BonePose {
  const keys = bone.keyframes;
  const first = keys[0];
  if (first === undefined) return IDENTITY;
  const last = keys[keys.length - 1] as BoneKeyframe;

  if (frame <= first.frame) return toPose(first);
  if (frame >= last.frame) return toPose(last);

  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i] as BoneKeyframe;
    const b = keys[i + 1] as BoneKeyframe;
    if (frame < a.frame || frame > b.frame) continue;

    const span = b.frame - a.frame;
    // 帧号重复（span=0）时取前一帧，别做 0 除——那会得到 NaN，
    // 而 NaN 变换在 canvas 上是「什么都不画」，又是一个不报错的错。
    if (span <= 0) return toPose(a);

    const t = (frame - a.frame) / span;
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      scaleX: lerp(a.scaleX, b.scaleX, t),
      scaleY: lerp(a.scaleY, b.scaleY, t),
      skewX: lerp(a.skewX, b.skewX, t),
      skewY: lerp(a.skewY, b.skewY, t),
    };
  }
  /* c8 ignore next */
  return toPose(last);
}

/** 整个动作在某一帧的姿态表：骨骼名 → 变换。 */
export function poseAt(
  movement: SpriteMovement,
  frame: number,
): ReadonlyMap<string, BonePose> {
  const out = new Map<string, BonePose>();
  for (const bone of movement.tracks) {
    out.set(bone.name, poseOfBone(bone, frame));
  }
  return out;
}
