import { describe, expect, it } from 'vitest';
import { buildCorpus, normalize, search, type SearchRecord } from '../src/corpus.js';

/**
 * 语料是**合成的**，但字段形状取自一份真实上游角色目录的实测：
 * `zh / jp / roman / kana / aliases`，**没有 ID**。
 */

const RECORDS: readonly SearchRecord[] = [
  {
    ref: 'a:character/1001',
    zh: '甲角色',
    jp: '甲キャラ',
    roman: 'Kou Kyara',
    kana: 'こう きゃら',
    aliases: ['另一个中文名'],
  },
  // 故意不给 ref：那份目录按显示名索引，交叉表没覆盖的条目就是没有 ref。
  { zh: '乙角色', jp: '乙キャラ', roman: 'Otsu Kyara' },
  { zh: '丙甲乙' },
];

const corpus = buildCorpus(RECORDS);

describe('normalize', () => {
  it('片假名折叠成平假名——不折的话敲片假名会「查无此人」', () => {
    expect(normalize('ヘイキャラ')).toBe(normalize('へいきゃら'));
  });

  it('去空白与大小写', () => {
    expect(normalize('  Kou   Kyara ')).toBe('koukyara');
    expect(normalize('こう きゃら')).toBe('こうきゃら');
  });
});

describe('search', () => {
  it('跨字段命中：中文、日文、罗马字、假名、别名', () => {
    for (const q of ['甲角色', '甲キャラ', 'kou kyara', 'コウキャラ', '另一个中文名']) {
      const hits = search(corpus, q);
      expect(hits[0]?.record.ref, `查 ${q} 没命中`).toBe('a:character/1001');
    }
  });

  it('完全相等排在前缀与包含之前', () => {
    const hits = search(corpus, '甲');
    // 「丙甲乙」只是包含，「甲角色」是前缀——前缀分更高。
    expect(hits.map((h) => h.record.zh)).toEqual(['甲角色', '丙甲乙']);
    expect(hits[0]?.score).toBe(2);
    expect(hits[1]?.score).toBe(1);
  });

  it('报出命中的是哪个字段——供 UI 显示，也供排查', () => {
    expect(search(corpus, 'コウキャラ')[0]?.field).toBe('kana');
    expect(search(corpus, '另一个中文名')[0]?.field).toBe('alias');
  });

  it('空查询返回空，而不是返回全部', () => {
    // 「空等于全选」在 186 条上看着无害，语料长到上万条时一次误触就把它们全倒出来。
    expect(search(corpus, '')).toEqual([]);
    expect(search(corpus, '   ')).toEqual([]);
  });

  it('limit 生效', () => {
    expect(search(corpus, '甲', { limit: 1 })).toHaveLength(1);
    expect(search(corpus, '甲', { limit: 0 })).toHaveLength(0);
  });

  it('没有 ref 的条目照样搜得到——只是不能跳转', () => {
    const hit = search(corpus, '乙角色')[0];
    expect(hit?.record.zh).toBe('乙角色');
    expect(hit?.record.ref).toBeUndefined();
  });

  it('一个可匹配字段都没有的记录不进语料', () => {
    expect(buildCorpus([{ ref: 'a:character/9' }, { zh: '   ' }])).toHaveLength(0);
  });
});
