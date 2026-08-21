import {
  boneOf,
  type BoneKeyframe,
  type BoneTransform,
  type MovementBone,
  type SpriteDoc,
  type SpriteMovement,
} from './armature.js';

/**
 * 按帧求骨骼姿态。
 *
 * 这是「真的能画出来」与「只能列个动作名」之间那一步：导出文件里存的是
 * **关键帧**，任意一帧的姿态要插出来。放在这里而不是舞台里，是因为它是纯算术
 * ——能在 node 上逐条验，而舞台只负责把算好的变换画上去。
 */

export type BonePose = BoneTransform;

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

/** 整个动作在某一帧的姿态表：骨骼名 → 变换。**局部姿态，未合成父级。** */
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

/**
 * 某一帧生效的那条关键帧。
 *
 * 显示索引与画序是**阶跃**的，不能像位移那样插值——插出来的 `dI` 是 1.5，
 * 取整之后这一帧画的是隔壁那个零件。所以它们单独按「最后一条不晚于本帧的
 * 关键帧」取，而不是走 `poseOfBone`。
 */
export function keyframeAt(bone: MovementBone, frame: number): BoneKeyframe | null {
  const keys = bone.keyframes;
  let hit: BoneKeyframe | null = null;
  for (const k of keys) {
    if (k.frame > frame) break;
    hit = k;
  }
  return hit ?? keys[0] ?? null;
}

/** 仿射矩阵，canvas 的 `setTransform(a,b,c,d,tx,ty)` 口径。 */
export interface Affine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

/**
 * 姿态 → 仿射矩阵。
 *
 * 两个斜切分量合起来就是 cocos 的旋转表达（纯旋转时 `skewX === skewY`）。
 * 只写在这一处：舞台与合成都取这里，免得两边各写一遍然后只改一处。
 */
export function matrixOf(pose: BonePose): Affine {
  return {
    a: pose.scaleX * Math.cos(pose.skewY),
    b: pose.scaleX * Math.sin(pose.skewY),
    c: -pose.scaleY * Math.sin(pose.skewX),
    d: pose.scaleY * Math.cos(pose.skewX),
    tx: pose.x,
    ty: pose.y,
  };
}

/** 一根骨骼在某一帧的最终状态：世界姿态 + 画序 + 画哪个零件。 */
export interface WorldBone {
  readonly name: string;
  /** 已合成父级的姿态。 */
  readonly pose: BonePose;
  readonly z: number;
  /**
   * 这一帧显示哪个零件的名字（图集里的帧名）。
   * null = 不显示——`dI` 为负、越界，或这根骨骼压根没登记 display。
   */
  readonly display: string | null;
}

/**
 * 整个动作在某一帧的**世界**姿态，按画序排好。
 *
 * ## 合成规则
 *
 * 位移经父级矩阵变换后加上父级位移，缩放相乘，斜切相加——这是 cocos 骨骼
 * 运行时 `Bone::applyParentTransform` 的算法，不是通用的矩阵连乘
 * （通用连乘会把父级的斜切也作用到子级的缩放上，结果不一样）。
 *
 * 没有轨道的骨骼停在自己的 `base` 上，**照样参与合成**：漏掉它，挂在它下面的
 * 子骨骼会被摆到错误的绝对位置。
 *
 * 有轨道但 `doc.bones` 里查不到的骨骼（有些导出只带动画不带结构），
 * 局部姿态即世界姿态，`display` 为 null。
 *
 * ## 🚧 待验证：CocosStudio 的「combined」版本
 *
 * 运行时对 `version >= 0.3` 的导出会先把 `bone_data` 的基础变换并进每一帧
 * （`TransformHelp::nodeConcat`），再做一次 `scale -= 1` 的补偿。那两步是
 * 运行时为自己的插值方式做的修正，**没有真实导出文件就无从验证**，
 * 猜着实现出来的东西会画得「看着像但不对」，正是本仓库不接受的那类错误。
 *
 * 所以这里**不做**那两步，只做上面那条无歧义的父级合成，并把根上的
 * `version` 原样读出来放在 `doc.dataVersion` 里。
 *
 * 证伪方式：拿一份真实 `*.ExportJson`，看根上的 `version`。若 ≥ 0.3 且画出来
 * 的零件整体偏移/缩放不对，就是这里缺了那两步——届时按版本分支补上，并把
 * 判据补成测试。
 */
export function worldPoseAt(
  doc: SpriteDoc,
  movement: SpriteMovement,
  frame: number,
): readonly WorldBone[] {
  const tracks = new Map(movement.tracks.map((t) => [t.name, t]));
  // 结构里的骨骼 + 只在动画里出现的骨骼，两边都要有。
  const names = doc.bones.map((b) => b.name);
  for (const t of movement.tracks) if (!names.includes(t.name)) names.push(t.name);

  const world = new Map<string, { pose: BonePose; matrix: Affine }>();
  const out: WorldBone[] = [];

  const resolve = (name: string): { pose: BonePose; matrix: Affine } => {
    const cached = world.get(name);
    if (cached !== undefined) return cached;

    const bone = boneOf(doc, name);
    const track = tracks.get(name);
    const local: BonePose =
      track !== undefined ? poseOfBone(track, frame) : (bone?.base ?? IDENTITY);

    let pose = local;
    if (bone?.parent != null) {
      // parseArmature 已经拦过成环与悬空父级，所以这里递归一定收敛。
      const parent = resolve(bone.parent);
      pose = {
        x: local.x * parent.matrix.a + local.y * parent.matrix.c + parent.pose.x,
        y: local.x * parent.matrix.b + local.y * parent.matrix.d + parent.pose.y,
        scaleX: local.scaleX * parent.pose.scaleX,
        scaleY: local.scaleY * parent.pose.scaleY,
        skewX: local.skewX + parent.pose.skewX,
        skewY: local.skewY + parent.pose.skewY,
      };
    }

    const entry = { pose, matrix: matrixOf(pose) };
    world.set(name, entry);
    return entry;
  };

  for (const name of names) {
    const bone = boneOf(doc, name);
    const track = tracks.get(name);
    const key = track !== undefined ? keyframeAt(track, frame) : null;

    let display: string | null = null;
    if (bone !== null && bone.displays.length > 0) {
      // 缺省 0：没有轨道的骨骼显示它的第一个零件。越界与负数一律不显示，
      // **不回退到第 0 个**——回退等于这一帧画了另一个零件且不报错。
      const index = key?.displayIndex ?? 0;
      display = index >= 0 && index < bone.displays.length ? bone.displays[index] ?? null : null;
    }

    out.push({
      name,
      pose: resolve(name).pose,
      // 每帧的 z 优先于骨骼自身的 z：运行时就是这么覆盖的。
      z: key?.z ?? bone?.z ?? 0,
      display,
    });
  }

  // 稳定排序：z 相同时保持声明顺序，否则两次渲染的遮挡关系会不一样。
  return out
    .map((b, i) => ({ b, i }))
    .sort((p, q) => p.b.z - q.b.z || p.i - q.i)
    .map(({ b }) => b);
}
