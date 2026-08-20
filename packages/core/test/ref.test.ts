import { describe, expect, it } from 'vitest';
import { formatRef, parseRef, refEquals, tryParseRef, withVariant } from '@aio/core';

describe('ResourceRef', () => {
  it('解析基本形态', () => {
    const r = parseRef('a:character/1001');
    expect(r).toEqual({ universe: 'a', kind: 'character', segments: ['1001'] });
  });

  it('解析多段与 variant', () => {
    const r = parseRef('a:sprite/100100/d_r');
    expect(r.segments).toEqual(['100100', 'd_r']);
    const s = parseRef('a:scenario/310241@zh');
    expect(s.variant).toBe('zh');
    expect(s.segments).toEqual(['310241']);
  });

  it('往返稳定', () => {
    for (const s of ['a:character/1001', 'b:model3d/100101', 'a:scenario/310241@zh', 'a:sprite/100100/d_r']) {
      expect(formatRef(parseRef(s))).toBe(s);
    }
  });

  it('🔴 拒绝没有 universe 前缀的裸 ID——mr 与 ex 的编号会撞', () => {
    expect(() => parseRef('100101')).toThrow(/universe/);
    expect(() => parseRef('character/1001')).toThrow(/universe/);
  });

  it('两个作品的同号资源不相等', () => {
    // b:model3d/100101 是角色乙；mr 那边的 100100 是角色甲。
    // 这两条 ref 绝不能被判为同一个东西。
    expect(refEquals(parseRef('b:character/100101'), parseRef('a:character/100101'))).toBe(false);
  });

  it('variant 参与相等判断——中文剧情不是日文剧情', () => {
    expect(refEquals(parseRef('a:scenario/310241@zh'), parseRef('a:scenario/310241@ja'))).toBe(false);
    expect(refEquals(parseRef('a:scenario/310241@zh'), parseRef('a:scenario/310241@zh'))).toBe(true);
  });

  it('拒绝未知 universe / kind / 非法段', () => {
    expect(() => parseRef('zz:character/1')).toThrow(/universe/);
    expect(() => parseRef('a:nope/1')).toThrow(/kind/);
    expect(() => parseRef('a:character/')).toThrow();
    expect(() => parseRef('a:character/../etc')).toThrow(/非法/);
    expect(() => parseRef('a:character/1@ZH')).toThrow(/variant/);
  });

  it('tryParseRef 对坏输入返回 null 而不抛', () => {
    expect(tryParseRef('rubbish')).toBeNull();
    expect(tryParseRef('a:character/1001')).not.toBeNull();
  });

  it('withVariant 换语言', () => {
    const zh = parseRef('a:scenario/310241@zh');
    expect(formatRef(withVariant(zh, 'ja'))).toBe('a:scenario/310241@ja');
    expect(formatRef(withVariant(zh, undefined))).toBe('a:scenario/310241');
  });
});
