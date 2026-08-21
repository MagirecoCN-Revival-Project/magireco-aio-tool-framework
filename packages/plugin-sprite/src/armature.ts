/**
 * CocosStudio 骨骼动画（`*.ExportJson`）的解析。
 *
 * **与渲染无关，也与上游无关**：这里只把导出文件变成一份归一化的动作清单。
 * 谁来画骨骼、怎么合图，是舞台的事（`player.ts` 的 `Stage`）。
 *
 * ## 格式判据来自实测
 *
 * 结构取自 `example-sprite-mirror` 里真实导出文件的**形状**（不是内容——素材一个字节
 * 都不进这棵树，铁律 9）：
 *
 * ```
 * armature_data[0].bone_data[]      骨骼：name / parent / 变换
 * animation_data[0].mov_data[]      动作：name / dr 帧长 / lp 循环 / sc 速度
 *   └ mov_bone_data[].frame_data[]  关键帧：fi 帧号 + 变换
 * texture_data[]                    图集分片：name / width / height / plistFile
 * ```
 *
 * 动作名一律**从数据里读**（实测样本是 `name_r` / `name_l` / `action_in` /
 * `action_out` / `outAnim` / `rearm`），绝不按命名规律推断有哪些动作——
 * 与铁律 2 同源：猜出来的动作名点下去是空的，而且不报错。
 */

export class ArmatureParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArmatureParseError';
  }
}

/** 一个节点的仿射参数。骨骼的基础变换与每一帧的变换是同一种东西。 */
export interface BoneTransform {
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly skewX: number;
  readonly skewY: number;
}

/**
 * 一条骨骼关键帧。字段名取自导出文件实测：
 * `fi` 帧号、`x`/`y` 位移、`cX`/`cY` 缩放、`kX`/`kY` 斜切（旋转）、
 * `dI` 这一帧显示哪个部件、`z` 这一帧的画序。
 */
export interface BoneKeyframe extends BoneTransform {
  readonly frame: number;
  /**
   * 显示哪个部件——索引到骨骼的 `displays`。
   *
   * 缺省 0（运行时的缺省值）。**负数与越界都表示「这一帧不显示」**，
   * 不回退到第 0 个部件：回退等于这一帧画了另一个零件，而且不报错。
   */
  readonly displayIndex: number;
  /** 这一帧的画序。导出文件没写就是 null，由骨骼自身的 z 兜底。 */
  readonly z: number | null;
}

/**
 * 一根骨骼的静态信息（导出文件的 `bone_data`）。
 *
 * 动画轨道（`mov_bone_data`）只说「这根骨骼这一帧变换成什么样」，
 * 而**它挂在谁下面、画哪个零件、画在第几层**都在这里。
 */
export interface SpriteBone {
  readonly name: string;
  /** 父骨骼名。null 表示是根。 */
  readonly parent: string | null;
  /** 骨骼自身的变换。没有轨道的骨骼就停在这个姿态。 */
  readonly base: BoneTransform;
  /** 画序，小的先画。 */
  readonly z: number;
  /**
   * 可显示的部件名，**按 `dI` 的下标排**。
   *
   * 非贴图的显示项（子骨架等）占位为 null 而不是被过滤掉——
   * 过滤会让后面每个 `dI` 都错位一格，于是每根骨骼都画了隔壁的零件。
   */
  readonly displays: readonly (string | null)[];
}

/** 一根骨骼在某个动作里的整条轨道。 */
export interface MovementBone {
  readonly name: string;
  /** 按帧号升序。空轨道表示这根骨骼在这个动作里不动。 */
  readonly keyframes: readonly BoneKeyframe[];
}

export interface SpriteMovement {
  readonly name: string;
  /** 帧长（导出文件里的 `dr`）。 */
  readonly frames: number;
  /** 是否循环（`lp`）。 */
  readonly loop: boolean;
  /** 速度倍率（`sc`）。 */
  readonly speedScale: number;
  /** 参与这个动作的骨骼轨道。舞台按帧求值后据此摆放。 */
  readonly tracks: readonly MovementBone[];
}

export interface SpriteTexture {
  readonly name: string;
  readonly plistFile: string;
}

export interface SpriteDoc {
  readonly armature: string;
  /** 骨架结构。有些导出只带动画不带结构，那时是空的——见 `parseArmature` 的说明。 */
  readonly bones: readonly SpriteBone[];
  readonly movements: readonly SpriteMovement[];
  readonly textures: readonly SpriteTexture[];
  /**
   * 导出文件根上的 `version`。**读出来但不据此改行为**——见 `pose.ts` 里
   * `worldPoseAt` 那段「待验证」。没写就是 0（运行时的缺省）。
   */
  readonly dataVersion: number;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ArmatureParseError(`${what} 不是对象`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new ArmatureParseError(`${what} 不是数组`);
  return value;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** 从一条记录里读出仿射参数。骨骼基础变换与关键帧用的是同一组字段名。 */
function transformOf(rec: Record<string, unknown>): BoneTransform {
  return {
    x: num(rec['x'], 0),
    y: num(rec['y'], 0),
    // 缩放缺省是 1 而不是 0——缺省成 0 会让整根骨骼消失，
    // 而「消失」看起来像是资源没加载，能查很久。
    scaleX: num(rec['cX'], 1),
    scaleY: num(rec['cY'], 1),
    skewX: num(rec['kX'], 0),
    skewY: num(rec['kY'], 0),
  };
}

/**
 * 骨架结构。
 *
 * `bone_data` 缺失或为空**不抛**：骨架结构与动画轨道是两份数据，缺前者只影响
 * 「画哪个零件、挂在谁下面」，不影响「按帧求姿态」。硬拦会把一个只是画不了
 * 贴图的文件变成打不开的文件。舞台据此降级成画骨骼方块。
 *
 * 但**结构自身坏掉要抛**：重名、父骨骼不存在、父子成环——这三种不抛的话，
 * 子骨骼会被摆到错误的绝对位置（成环还会让合成死循环），画面上看起来
 * 像是模型坏了。
 */
function parseBones(raw: unknown): SpriteBone[] {
  if (!Array.isArray(raw)) return [];

  const bones: SpriteBone[] = [];
  const seen = new Set<string>();
  for (const b of raw) {
    const rec = asRecord(b, 'bone_data[]');
    const name = str(rec['name']);
    if (name === undefined) throw new ArmatureParseError('bone_data[] 缺 name');
    if (seen.has(name)) {
      throw new ArmatureParseError(`骨骼名 ${JSON.stringify(name)} 重复`);
    }
    seen.add(name);

    const displays: (string | null)[] = [];
    const dd = rec['display_data'];
    if (Array.isArray(dd)) {
      for (const d of dd) {
        displays.push(str(asRecord(d, `${name}.display_data[]`)['name']) ?? null);
      }
    }

    bones.push({
      name,
      parent: str(rec['parent']) ?? null,
      base: transformOf(rec),
      z: num(rec['z'], 0),
      displays,
    });
  }

  for (const bone of bones) {
    if (bone.parent !== null && !seen.has(bone.parent)) {
      throw new ArmatureParseError(
        `骨骼 ${JSON.stringify(bone.name)} 的父骨骼 ${JSON.stringify(bone.parent)} 不存在`,
      );
    }
  }

  const byName = new Map(bones.map((b) => [b.name, b]));
  for (const bone of bones) {
    const path = new Set<string>([bone.name]);
    let cur = bone.parent;
    while (cur !== null) {
      if (path.has(cur)) {
        throw new ArmatureParseError(`骨骼父子关系成环：${[...path, cur].join(' → ')}`);
      }
      path.add(cur);
      cur = byName.get(cur)?.parent ?? null;
    }
  }

  return bones;
}

/**
 * 解析导出文件。结构不对一律抛——**不做宽松模式**。
 *
 * 一个解析错的骨骼文件不会白屏，它会**播成另一个样子**（少一段动作、
 * 帧长不对、骨骼错位），而没人会立刻发现。与铁律 1、2 同一条判断。
 */
export function parseArmature(input: unknown): SpriteDoc {
  const root = asRecord(input, '导出文件');

  const armatures = asArray(root['armature_data'], 'armature_data');
  const first = armatures[0];
  if (first === undefined) throw new ArmatureParseError('armature_data 是空的');
  const armatureRec = asRecord(first, 'armature_data[0]');
  const armature = str(armatureRec['name']);
  if (armature === undefined) throw new ArmatureParseError('armature_data[0] 缺 name');

  const bones = parseBones(armatureRec['bone_data']);

  const animations = asArray(root['animation_data'], 'animation_data');
  const anim = animations[0];
  if (anim === undefined) throw new ArmatureParseError('animation_data 是空的');
  const movRaw = asArray(asRecord(anim, 'animation_data[0]')['mov_data'], 'mov_data');

  const movements: SpriteMovement[] = [];
  const seen = new Set<string>();
  for (const [i, m] of movRaw.entries()) {
    const mov = asRecord(m, `mov_data[${i}]`);
    const name = str(mov['name']);
    if (name === undefined) throw new ArmatureParseError(`mov_data[${i}] 缺 name`);
    if (seen.has(name)) {
      // 重名动作会让「按名字选动作」变成看运气选中哪一个。
      throw new ArmatureParseError(`动作名 ${JSON.stringify(name)} 重复`);
    }
    seen.add(name);

    const frames = mov['dr'];
    if (typeof frames !== 'number' || !Number.isFinite(frames) || frames <= 0) {
      // 不给它编一个默认帧长：帧长错了动作会播成另一个速度，而且不报错。
      throw new ArmatureParseError(
        `动作 ${JSON.stringify(name)} 的 dr（帧长）不是正数：${String(frames)}`,
      );
    }

    const scRaw = mov['sc'];
    const speedScale =
      typeof scRaw === 'number' && Number.isFinite(scRaw) && scRaw > 0 ? scRaw : 1;

    const tracks: MovementBone[] = [];
    const boneRaw = mov['mov_bone_data'];
    if (Array.isArray(boneRaw)) {
      for (const b of boneRaw) {
        const bone = asRecord(b, 'mov_bone_data[]');
        const boneName = str(bone['name']);
        if (boneName === undefined) continue;

        const keyframes: BoneKeyframe[] = [];
        const fdRaw = bone['frame_data'];
        if (Array.isArray(fdRaw)) {
          for (const f of fdRaw) {
            const fd = asRecord(f, `${boneName}.frame_data[]`);
            const z = fd['z'];
            keyframes.push({
              frame: num(fd['fi'], 0),
              ...transformOf(fd),
              // 缺省 0 是运行时的缺省值。负数与越界表示不显示，那由舞台判。
              displayIndex: num(fd['dI'], 0),
              z: typeof z === 'number' && Number.isFinite(z) ? z : null,
            });
          }
          // 导出文件里帧号通常已升序，但不能指望——乱序会让插值取到错的区间。
          keyframes.sort((a, b2) => a.frame - b2.frame);
        }
        tracks.push({ name: boneName, keyframes });
      }
    }

    movements.push({ name, frames, loop: mov['lp'] === true, speedScale, tracks });
  }

  if (movements.length === 0) {
    throw new ArmatureParseError('一个动作都没解析出来');
  }

  const textures: SpriteTexture[] = [];
  const texRaw = root['texture_data'];
  if (Array.isArray(texRaw)) {
    for (const t of texRaw) {
      const tex = asRecord(t, 'texture_data[]');
      const name = str(tex['name']);
      const plistFile = str(tex['plistFile']);
      if (name !== undefined && plistFile !== undefined) textures.push({ name, plistFile });
    }
  }

  return { armature, bones, movements, textures, dataVersion: num(root['version'], 0) };
}

/** 按名字取动作。**查不到返回 null，绝不退回第一个**——那是显示了别的动作。 */
export function movementOf(doc: SpriteDoc, name: string): SpriteMovement | null {
  return doc.movements.find((m) => m.name === name) ?? null;
}

/** 按名字取骨骼。查不到返回 null——舞台据此只画方块，不去猜它挂在谁下面。 */
export function boneOf(doc: SpriteDoc, name: string): SpriteBone | null {
  return doc.bones.find((b) => b.name === name) ?? null;
}
