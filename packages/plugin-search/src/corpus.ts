/**
 * 检索语料与匹配。
 *
 * **与渲染无关，也与上游无关**：这里只把一份角色目录变成可检索的语料，
 * 并回答「查这个串命中了谁」。结果长什么样是舞台的事。
 *
 * ## 一条实测出来的硬约束：不能按名字 join
 *
 * 实测过的一份上游角色目录（186 条）字段是
 * `zh / jp / roman / kana / image / star / classes / aliases`——**没有任何 ID**，
 * `image` 就是中文名本身。也就是说这份数据是按**显示名**索引的。
 *
 * 而显示名在不同数据源之间对不上：同一个角色，那份目录的 `zh` 是「环角色甲」，
 * 我们 registry 里 `a:character/1001` 记的是「角色甲」——后者在那份目录里
 * 只是 `aliases` 之一。**按名字 join 会把人配错，而且不报错。**
 *
 * 所以这里的语料条目带一个**可选**的 `ref`：
 *
 *   - 有 ref（由交叉表给出）→ 命中后可以发 `entity.focused`，能跳去档案；
 *   - 没有 ref → 照样能被搜到、能显示，但**不发事件、不跳转**。
 *
 * 绝不按名字凑一个 ref 出来（铁律 2）。补齐 ref 是 Phase 4 的人工核对工作。
 */

export interface SearchRecord {
  /** 交叉表给出的 ref 字符串。**没有就是没有，不许按名字推**。 */
  readonly ref?: string;
  readonly zh?: string;
  readonly jp?: string;
  readonly roman?: string;
  readonly kana?: string;
  readonly aliases?: readonly string[];
  readonly tags?: readonly string[];
}

export type MatchField = 'zh' | 'jp' | 'roman' | 'kana' | 'alias';

export interface SearchEntry {
  readonly record: SearchRecord;
  /** 归一化后的可匹配串，连同它来自哪个字段。 */
  readonly keys: readonly { readonly field: MatchField; readonly value: string }[];
}

export interface SearchHit {
  readonly record: SearchRecord;
  readonly field: MatchField;
  /** 3=完全相等 2=前缀 1=包含。用于排序，数值本身没有对外含义。 */
  readonly score: 3 | 2 | 1;
}

const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;

/**
 * 归一化：大小写、空白、片假名 → 平假名。
 *
 * 片假名折叠是实打实的需求而不是锦上添花：目录里 `kana` 存的是平假名
 * （`たまき 角色甲`），而用户很可能敲片假名。不折叠的话「タマキ」搜不到任何东西，
 * 且看起来像是「这个角色不存在」。
 *
 * 空白也要去掉——`たまき 角色甲` 带一个空格，而没人会在搜索框里还原那个空格。
 */
export function normalize(input: string): string {
  let out = '';
  for (const ch of input.trim().toLowerCase()) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    if (/\s/.test(ch)) continue;
    out +=
      code >= KATAKANA_START && code <= KATAKANA_END
        ? String.fromCodePoint(code - 0x60)
        : ch;
  }
  return out;
}

export function buildCorpus(records: readonly SearchRecord[]): readonly SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const record of records) {
    const keys: { field: MatchField; value: string }[] = [];
    const push = (field: MatchField, raw: string | undefined): void => {
      if (raw === undefined) return;
      const value = normalize(raw);
      if (value !== '') keys.push({ field, value });
    };
    push('zh', record.zh);
    push('jp', record.jp);
    push('roman', record.roman);
    push('kana', record.kana);
    for (const a of record.aliases ?? []) push('alias', a);

    // 一个字段都归一化不出来的记录进语料只会变成永远搜不到的噪声。
    if (keys.length > 0) entries.push({ record, keys });
  }
  return entries;
}

export interface SearchOptions {
  readonly limit?: number;
}

/**
 * 查。空串返回空数组——**不返回全部**。
 *
 * 「空查询等于全选」在 186 条上看着无害，但这套语料将来要装 1,404 条卡牌与
 * 10,511 条语音字幕；那时一次误触会把整份语料倒进 UI。
 */
export function search(
  corpus: readonly SearchEntry[],
  query: string,
  options: SearchOptions = {},
): readonly SearchHit[] {
  const q = normalize(query);
  if (q === '') return [];

  const hits: SearchHit[] = [];
  for (const entry of corpus) {
    let best: SearchHit | null = null;
    for (const key of entry.keys) {
      const score: 3 | 2 | 1 | 0 =
        key.value === q ? 3 : key.value.startsWith(q) ? 2 : key.value.includes(q) ? 1 : 0;
      if (score === 0) continue;
      if (best === null || score > best.score) {
        best = { record: entry.record, field: key.field, score };
      }
    }
    if (best !== null) hits.push(best);
  }

  // 分数降序；同分保持语料顺序（稳定），不按名字再排——
  // 换个排序规则就换了「谁在第一个」，那是会被用户记住的行为。
  hits.sort((a, b) => b.score - a.score);
  const limit = options.limit;
  return limit !== undefined && limit >= 0 ? hits.slice(0, limit) : hits;
}
