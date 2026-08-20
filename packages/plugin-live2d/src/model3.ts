/**
 * Cubism `*.model3.json` 的解析。
 *
 * **与渲染无关，也与上游无关**：这里只把模型描述文件变成一份归一化清单
 * （要哪些文件、有哪些动作与表情、口型同步挂在哪个参数上）。
 * 真正把它画出来是舞台的事（`session.ts` 的 `Stage`）。
 *
 * ## 格式判据来自实测
 *
 * 取自真实模型描述文件的**形状**（素材一个字节都不进这棵树，铁律 9）：
 *
 * ```
 * FileReferences.Moc          "800201.moc3"
 * FileReferences.Textures     ["textures/texture_00.png", …]
 * FileReferences.Physics      null            ← 注意：是 null，不是缺键
 * FileReferences.Pose         "800201.pose3.json"
 * FileReferences.DisplayInfo  null
 * FileReferences.Motions      { motion_000: [{File: "motions/…"}], … }
 * FileReferences.Expressions  [{Name: "mtn_ex_010", File: "expressions/…"}]
 * Groups                      [{Target:"Parameter", Name:"EyeBlink", Ids:[…]},
 *                              {Target:"Parameter", Name:"LipSync",  Ids:[…]}]
 * ```
 *
 * **`null` 而不是缺键**这一点是实测出来的，也是最容易写崩的地方：
 * 只判断 `'Physics' in fileRefs` 会得到 true，然后拿着 null 去当路径用。
 */

export class Model3ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Model3ParseError';
  }
}

export interface Live2dMotion {
  /** 动作组名，如 `motion_000`。**来自数据，不按命名规律推断**。 */
  readonly group: string;
  /** 组内第几条（同一组可以有多条候选）。 */
  readonly index: number;
  readonly file: string;
}

export interface Live2dExpression {
  readonly name: string;
  readonly file: string;
}

export interface Live2dDoc {
  readonly name: string | null;
  /** 主体文件。没有它什么都画不出来，所以缺了直接抛。 */
  readonly moc: string;
  readonly textures: readonly string[];
  readonly physics: string | null;
  readonly pose: string | null;
  readonly displayInfo: string | null;
  readonly motions: readonly Live2dMotion[];
  readonly expressions: readonly Live2dExpression[];
  /** 眨眼参数 ID。空数组表示这个模型没登记眨眼。 */
  readonly eyeBlink: readonly string[];
  /** 口型同步参数 ID。空数组 = 不支持口型同步，UI 据此不画那个开关。 */
  readonly lipSync: readonly string[];
}

/** `null` 与空串都算「没有」。这一条是这份格式最容易踩的坑。 */
function optionalPath(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Model3ParseError(`${what} 不是对象`);
  }
  return value as Record<string, unknown>;
}

/**
 * 解析模型描述文件。缺关键部件一律抛——**不做宽松模式**。
 *
 * 一个缺贴图的模型不会白屏，它会画成一团纯色；一个动作组名猜错的模型
 * 点下去没反应。两者都不报错，都要靠人眼发现。
 */
export function parseModel3(input: unknown): Live2dDoc {
  const root = record(input, '模型描述文件');
  const refs = record(root['FileReferences'], 'FileReferences');

  const moc = optionalPath(refs['Moc']);
  if (moc === null) {
    throw new Model3ParseError('FileReferences.Moc 缺失——没有它什么都画不出来');
  }

  const texturesRaw = refs['Textures'];
  if (!Array.isArray(texturesRaw)) {
    throw new Model3ParseError('FileReferences.Textures 不是数组');
  }
  const textures = texturesRaw.map(optionalPath).filter((t): t is string => t !== null);
  if (textures.length === 0) {
    // 缺贴图不会白屏，会画成一团纯色——比报错更难查。
    throw new Model3ParseError('FileReferences.Textures 是空的');
  }

  const motions: Live2dMotion[] = [];
  const motionsRaw = refs['Motions'];
  if (motionsRaw !== null && motionsRaw !== undefined) {
    const groups = record(motionsRaw, 'FileReferences.Motions');
    for (const [group, listRaw] of Object.entries(groups)) {
      if (!Array.isArray(listRaw)) {
        throw new Model3ParseError(`动作组 ${JSON.stringify(group)} 不是数组`);
      }
      for (const [index, item] of listRaw.entries()) {
        const file = optionalPath(record(item, `动作组 ${group}[${index}]`)['File']);
        if (file === null) {
          throw new Model3ParseError(`动作 ${group}[${index}] 缺 File`);
        }
        motions.push({ group, index, file });
      }
    }
  }

  const expressions: Live2dExpression[] = [];
  const exprRaw = refs['Expressions'];
  if (Array.isArray(exprRaw)) {
    for (const [i, item] of exprRaw.entries()) {
      const e = record(item, `Expressions[${i}]`);
      const name = optionalPath(e['Name']);
      const file = optionalPath(e['File']);
      if (name === null || file === null) {
        throw new Model3ParseError(`Expressions[${i}] 缺 Name 或 File`);
      }
      expressions.push({ name, file });
    }
  }

  const groupIds = (want: string): readonly string[] => {
    const list = root['Groups'];
    if (!Array.isArray(list)) return [];
    for (const g of list) {
      if (typeof g !== 'object' || g === null) continue;
      const entry = g as Record<string, unknown>;
      if (entry['Name'] !== want) continue;
      const ids = entry['Ids'];
      if (!Array.isArray(ids)) return [];
      return ids.filter((x): x is string => typeof x === 'string');
    }
    return [];
  };

  return {
    name: optionalPath(root['Name']),
    moc,
    textures,
    physics: optionalPath(refs['Physics']),
    pose: optionalPath(refs['Pose']),
    displayInfo: optionalPath(refs['DisplayInfo']),
    motions,
    expressions,
    eyeBlink: groupIds('EyeBlink'),
    lipSync: groupIds('LipSync'),
  };
}

/** 这个模型登记的所有动作组名。UI 用它画动作列表——**列表来自数据**。 */
export function motionGroups(doc: Live2dDoc): readonly string[] {
  return [...new Set(doc.motions.map((m) => m.group))];
}

/** 取一条动作。查不到返回 null，**绝不退回第一条**——那是播了别的动作。 */
export function motionOf(doc: Live2dDoc, group: string, index = 0): Live2dMotion | null {
  return doc.motions.find((m) => m.group === group && m.index === index) ?? null;
}
