import {
  formatRef,
  parseRef,
  refId,
  type RefKind,
  type ResourceRef,
  type Universe,
} from '@aio/core';

/**
 * 实体交叉表（Registry）。
 *
 * 「看角色简介时点一下就显示精灵」这句话，落到代码上就是一次查表：
 * 给我 `a:character/1001`，告诉我它的精灵、Live2D、3D 模型、语音前缀分别是什么。
 *
 * ## 为什么这必须是数据，不能是公式
 *
 * 看起来有规律：命名空间 a的精灵 unit = charaId + 服装号，`1001` + `00` = `100100`。
 * 但实测下来这个公式**不成立**：
 *
 *   - wiki 给 charaId `1001` 登记的 costumeIds 是 `['03','04','50','53']`，
 *     而 kyu 镜像里实际存在的是 `100100 / 100101 / 100109`——两边对不上，
 *     按公式拼出来的一半是 404。
 *   - 命名空间 b 的 `style3dCharacterMstId: 100101` 对应的资源名是
 *     `chara_100107_battle_unit`——ID 与资源号根本不是一回事。
 *   - 最危险的一条：`100101` 在两个作品里都存在。命名空间 b 的是角色乙，
 *     命名空间 a的 `100100` 是角色甲。**按数字匹配会把两个角色搞混，而且不报错。**
 *
 * 所以交叉表是**人工核对过的数据**，由 universe 严格隔离，查不到就是查不到——
 * 绝不回退到"按规律猜一个"。猜错的代价是显示了另一个角色，而没人会立刻发现。
 */

/** 一个实体在各作品域内的全部关联资源。 */
export interface EntityLinks {
  /** 这条记录描述谁。 */
  readonly ref: string;
  readonly nameZh?: string;
  readonly nameJa?: string;
  /** 关联资源，按 kind 分组。值是完整 ref 字符串。 */
  readonly links: Readonly<Partial<Record<RefKind, readonly string[]>>>;
}

export interface RegistryData {
  readonly version: number;
  /** 生成时间，用于判断陈旧程度。 */
  readonly generated?: string;
  readonly entities: readonly EntityLinks[];
}

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

interface Entry {
  readonly ref: ResourceRef;
  readonly key: string;
  readonly nameZh?: string;
  readonly nameJa?: string;
  readonly links: ReadonlyMap<RefKind, readonly ResourceRef[]>;
}

export class Registry {
  readonly #byKey = new Map<string, Entry>();
  /** 反向索引：任一关联资源 → 拥有它的实体。 */
  readonly #owners = new Map<string, string>();

  private constructor(data: RegistryData) {
    for (const raw of data.entities) {
      const ref = parseRef(raw.ref);
      const key = formatRef(ref);
      if (this.#byKey.has(key)) {
        throw new RegistryError(`交叉表里 ${key} 重复登记`);
      }

      const links = new Map<RefKind, readonly ResourceRef[]>();
      for (const [kind, values] of Object.entries(raw.links)) {
        if (values === undefined) continue;
        const parsed = values.map((v) => {
          const target = parseRef(v);
          if (target.universe !== ref.universe) {
            // 跨作品链接一律拒收。这正是撞号事故的形状：
            // 命名空间 a的角色挂上 命名空间 b 的模型，两边编号都"看着对"。
            throw new RegistryError(
              `${key} 关联了跨作品资源 ${v}` +
                `（${ref.universe} → ${target.universe}）——两个作品的编号会撞，不允许直接关联`,
            );
          }
          if (target.kind !== kind) {
            throw new RegistryError(`${key} 的 ${kind} 分组里混进了 ${v}`);
          }
          return target;
        });
        links.set(kind as RefKind, parsed);

        for (const t of parsed) {
          this.#owners.set(formatRef(t), key);
        }
      }

      const entry: Entry = {
        ref,
        key,
        links,
        ...(raw.nameZh === undefined ? {} : { nameZh: raw.nameZh }),
        ...(raw.nameJa === undefined ? {} : { nameJa: raw.nameJa }),
      };
      this.#byKey.set(key, entry);
    }
  }

  static from(data: RegistryData): Registry {
    if (data.version !== 1) {
      throw new RegistryError(`不支持的交叉表版本 ${data.version}`);
    }
    return new Registry(data);
  }

  static empty(): Registry {
    return new Registry({ version: 1, entities: [] });
  }

  get size(): number {
    return this.#byKey.size;
  }

  /**
   * 查某个实体的关联资源。
   *
   * **查不到返回空数组，绝不按编号规律猜。** 见本文件顶部的说明。
   */
  linksOf(ref: ResourceRef, kind: RefKind): readonly ResourceRef[] {
    const entry = this.#byKey.get(formatRef(ref));
    if (entry === undefined) return [];
    return entry.links.get(kind) ?? [];
  }

  /** 是否存在某类关联——UI 用它决定「显示精灵」这个按钮画不画。 */
  has(ref: ResourceRef, kind: RefKind): boolean {
    return this.linksOf(ref, kind).length > 0;
  }

  /** 取首选关联，没有则 null。 */
  primaryLink(ref: ResourceRef, kind: RefKind): ResourceRef | null {
    return this.linksOf(ref, kind)[0] ?? null;
  }

  /** 反查：这份资源属于哪个实体？用于「ADV 里点了立绘 → 打开角色档案」。 */
  ownerOf(ref: ResourceRef): ResourceRef | null {
    const key = this.#owners.get(formatRef(ref));
    if (key === undefined) return null;
    return this.#byKey.get(key)?.ref ?? null;
  }

  displayName(ref: ResourceRef, prefer: 'zh' | 'ja' = 'zh'): string {
    const entry = this.#byKey.get(formatRef(ref));
    if (entry === undefined) return formatRef(ref);
    const zh = entry.nameZh;
    const ja = entry.nameJa;
    return (prefer === 'zh' ? (zh ?? ja) : (ja ?? zh)) ?? formatRef(ref);
  }

  /** 列出某作品域下某类实体，用于目录页。 */
  list(universe: Universe, kind: RefKind): readonly ResourceRef[] {
    const out: ResourceRef[] = [];
    for (const entry of this.#byKey.values()) {
      if (entry.ref.universe === universe && entry.ref.kind === kind) out.push(entry.ref);
    }
    return out.sort((a, b) => refId(a).localeCompare(refId(b)));
  }
}
