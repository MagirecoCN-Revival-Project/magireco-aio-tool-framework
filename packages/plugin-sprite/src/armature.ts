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

export interface SpriteMovement {
  readonly name: string;
  /** 帧长（导出文件里的 `dr`）。 */
  readonly frames: number;
  /** 是否循环（`lp`）。 */
  readonly loop: boolean;
  /** 速度倍率（`sc`）。 */
  readonly speedScale: number;
  /** 参与这个动作的骨骼名，供舞台按需装配。 */
  readonly bones: readonly string[];
}

export interface SpriteTexture {
  readonly name: string;
  readonly plistFile: string;
}

export interface SpriteDoc {
  readonly armature: string;
  readonly movements: readonly SpriteMovement[];
  readonly textures: readonly SpriteTexture[];
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

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
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
  const armature = str(asRecord(first, 'armature_data[0]')['name']);
  if (armature === undefined) throw new ArmatureParseError('armature_data[0] 缺 name');

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

    const bones: string[] = [];
    const boneRaw = mov['mov_bone_data'];
    if (Array.isArray(boneRaw)) {
      for (const b of boneRaw) {
        const bone = str(asRecord(b, 'mov_bone_data[]')['name']);
        if (bone !== undefined) bones.push(bone);
      }
    }

    movements.push({ name, frames, loop: mov['lp'] === true, speedScale, bones });
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

  return { armature, movements, textures };
}

/** 按名字取动作。**查不到返回 null，绝不退回第一个**——那是显示了别的动作。 */
export function movementOf(doc: SpriteDoc, name: string): SpriteMovement | null {
  return doc.movements.find((m) => m.name === name) ?? null;
}
