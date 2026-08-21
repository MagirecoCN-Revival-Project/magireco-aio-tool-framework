import { describe, expect, it } from 'vitest';
import { parseRef } from '@aio/core';
import { layoutChart, type ChartEntry } from '../src/chart.js';
import { parseProfile, ProfileParseError } from '../src/profile.js';
import { parseCompare } from '../src/index.js';

/** 档案全部是**合成的**（铁律 9）。这里验的是比例与「没数据」怎么处理。 */

const entry = (id: string, heightCm: number | null, focus = false): ChartEntry => ({
  ref: parseRef(`a:character/${id}`),
  profile: { name: id, heightCm, aliases: [] },
  focus,
});

describe('parseProfile', () => {
  it('读出名字、身高与别名', () => {
    expect(parseProfile({ name: '角色甲', heightCm: 158, aliases: ['角色甲'] })).toEqual({
      name: '角色甲',
      heightCm: 158,
      aliases: ['角色甲'],
    });
  });

  it('没登记身高不是错误——heightCm 是 null，不是 0', () => {
    // 0 在图上读作「身高 0」，那是一句数据没说过的话。
    expect(parseProfile({ name: 'x' }).heightCm).toBeNull();
    expect(parseProfile({ name: 'x', heightCm: null }).heightCm).toBeNull();
  });

  it('身高必须是正数，字符串数字一律拒绝', () => {
    // "150" 与 "150cm" 里只有一个能被 Number 读对，读错的那个是 NaN，
    // 而 NaN 在图上是「不画」，看起来像没数据。
    for (const bad of ['150', '150cm', 0, -3, Number.NaN]) {
      expect(() => parseProfile({ name: 'x', heightCm: bad })).toThrow(ProfileParseError);
    }
  });

  it('缺 name 直接抛——没有名字就画不出标签', () => {
    expect(() => parseProfile({ heightCm: 150 })).toThrow(/缺 name/);
    expect(() => parseProfile('x')).toThrow(/不是对象/);
  });
});

describe('layoutChart', () => {
  it('缺省量程从 0 起——截断纵轴会让 155 与 160 看起来差一倍', () => {
    const l = layoutChart([entry('a', 160), entry('b', 155)]);
    expect(l.bars.map((b) => b.ratio)).toEqual([1, 155 / 160]);
  });

  it('显式截断时刻度照实标出来', () => {
    const l = layoutChart([entry('a', 160), entry('b', 155)], { zeroBased: false, tickCm: 5 });
    expect(l.bars[0]!.ratio).toBe(1);
    expect(l.bars[1]!.ratio).toBeGreaterThan(0);
    expect(l.bars[1]!.ratio).toBeLessThan(0.5);
    // 刻度从 base 之上第一个整数倍开始，一直到最高的那个。
    expect(l.ticks.map((t) => t.cm)).toEqual([155, 160]);
  });

  it('按身高从高到矮；同高时按 ref 文本序——必须是全序', () => {
    // 否则同高的两个角色每次刷新会换位置，看起来像数据在变。
    const l = layoutChart([entry('c', 150), entry('a', 150), entry('b', 170)]);
    expect(l.bars.map((b) => b.label)).toEqual(['b', 'a', 'c']);
  });

  it('没登记身高的不画柱子，但列进 missing——不能悄悄消失', () => {
    const l = layoutChart([entry('a', 160), entry('b', null)]);
    expect(l.bars.map((b) => b.label)).toEqual(['a']);
    expect(l.missing.map((r) => r.segments[0])).toEqual(['b']);
  });

  it('一个有身高的都没有时不崩，返回空图', () => {
    const l = layoutChart([entry('a', null)]);
    expect(l).toMatchObject({ bars: [], ticks: [], maxCm: 0 });
    expect(l.missing).toHaveLength(1);
  });

  it('只有一个角色且量程从它自己起时不做 0 除', () => {
    // NaN 高度在 DOM 上是「不画」，又是一个不报错的错。
    const l = layoutChart([entry('a', 160)], { zeroBased: false });
    expect(l.bars[0]!.ratio).toBe(1);
    expect(Number.isNaN(l.bars[0]!.ratio)).toBe(false);
  });

  it('刻度与柱子是同一个口径；量程从 0 起时基线也是一条刻度', () => {
    const l = layoutChart([entry('a', 200)], { tickCm: 100 });
    expect(l.ticks).toEqual([
      { cm: 0, ratio: 0 },
      { cm: 100, ratio: 0.5 },
      { cm: 200, ratio: 1 },
    ]);
  });
});

describe('parseCompare', () => {
  it('拆逗号、去空白、去重', () => {
    const refs = parseCompare('a:character/1001, a:character/1002 ,a:character/1001');
    expect(refs.map((r) => r.segments[0])).toEqual(['1001', '1002']);
  });

  it('拆不出来的丢掉而不是抛——对比名单来自调用方', () => {
    // 一个写错的 ref 让整张图打不开，代价远大于少画一根柱子。
    expect(parseCompare('a:character/1001,,,垃圾').map((r) => r.segments[0])).toEqual(['1001']);
    expect(parseCompare(undefined)).toEqual([]);
    expect(parseCompare(123)).toEqual([]);
  });

  it('裸 ID 依然被拒绝，不按当前作品补一个前缀', () => {
    // 补前缀就是把一个角色的身高配到另一个角色头上，而且不报错（铁律 1）。
    expect(parseCompare('100101')).toEqual([]);
  });
});
