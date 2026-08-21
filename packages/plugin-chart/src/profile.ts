/**
 * 角色档案（资源面 role = `profile`）的解析。
 *
 * ## 为什么档案是资源而不是交叉表
 *
 * `@aio/registry` 管的是**实体之间的关联**（角色 ↔ 精灵 / Live2D / 3D /
 * 语音）。身高是角色**自己的属性**，不是关联，所以它按 ref 存在资源面上，
 * 与立绘、语音同一条路径取。好处是下架、换源、多源回退这些能力它照样有，
 * 而插件依然一个 URL 都不碰（铁律 3）。
 *
 * ## 字段名里带单位
 *
 * 是 `heightCm` 而不是 `height`。`height: 150` 到底是厘米、寸还是像素，
 * 数据方与读取方各猜一次就会错，而**错了不报错**——图表照画，只是比例不对。
 * 单位写进字段名，猜不了。
 *
 * ## 没登记身高不是错误
 *
 * 有些角色（人形以外的、设定里没写的）确实没有身高。那时 `heightCm` 是 null，
 * 图表**不给它画柱子**，也不当成 0——画成 0 在图上读作「身高 0」，
 * 而那是一句数据没说过的话。
 */

export class ProfileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileParseError';
  }
}

export interface CharacterProfile {
  /** 显示名。档案里没有名字就没法画标签，所以它是必填的。 */
  readonly name: string;
  /** 厘米。null = 数据里没登记，不是 0。 */
  readonly heightCm: number | null;
  /** 别名/其它语言的名字，图表用不上但一起读出来，免得调用方再取一次。 */
  readonly aliases: readonly string[];
}

export function parseProfile(input: unknown, what = '档案'): CharacterProfile {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ProfileParseError(`${what} 不是对象`);
  }
  const rec = input as Record<string, unknown>;

  const name = rec['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ProfileParseError(`${what} 缺 name`);
  }

  let heightCm: number | null = null;
  const raw = rec['heightCm'];
  if (raw !== undefined && raw !== null) {
    // 不接受字符串数字：`"150"` 与 `"150cm"` 里只有一个能被 Number 读对，
    // 而读错的那个是 NaN——NaN 在图上是「不画」，看起来像没数据。
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      throw new ProfileParseError(
        `${what} 的 heightCm 不是正数：${JSON.stringify(raw)}（没登记就写 null 或整个不写）`,
      );
    }
    heightCm = raw;
  }

  const aliases: string[] = [];
  const rawAliases = rec['aliases'];
  if (Array.isArray(rawAliases)) {
    for (const a of rawAliases) if (typeof a === 'string' && a.trim() !== '') aliases.push(a);
  }

  return { name, heightCm, aliases };
}
