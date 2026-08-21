import { formatRef, type ResourceRef } from '@aio/core';
import type { CharacterProfile } from './profile.js';

/**
 * 身高对比图的**布局算术**。
 *
 * 与渲染无关：这里只算「谁排第几、柱子多高、标尺画在哪」。谁来画柱子是舞台的事。
 * 于是整套判据在 node 上验得了——身高图最容易出的错不是画不出来，是**比例不对**，
 * 而比例是纯算术。
 */

export interface ChartEntry {
  readonly ref: ResourceRef;
  readonly profile: CharacterProfile;
  /** 这一条是意图里点名的那个角色（画重点用）。 */
  readonly focus: boolean;
}

export interface ChartBar {
  readonly ref: ResourceRef;
  readonly label: string;
  readonly heightCm: number;
  /** 0–1，相对本图最高的那个。舞台乘上自己的像素高度即可。 */
  readonly ratio: number;
  readonly focus: boolean;
}

export interface ChartTick {
  readonly cm: number;
  /** 0–1，与 `ChartBar.ratio` 同一个口径。 */
  readonly ratio: number;
}

export interface ChartLayout {
  readonly bars: readonly ChartBar[];
  /** 标尺刻度，从矮到高。没有柱子时是空的。 */
  readonly ticks: readonly ChartTick[];
  /** 本图的量程上限（厘米）。 */
  readonly maxCm: number;
  /**
   * 有档案但没登记身高的角色，按 ref 列出来。
   *
   * **不画柱子，也不当成 0**——0 在图上读作「身高 0」，那是一句数据没说过的话。
   * 但也不能悄悄消失：调用方要能告诉用户「这几个没有数据」。
   */
  readonly missing: readonly ResourceRef[];
}

export interface ChartOptions {
  /** 刻度间隔（厘米），缺省 20。 */
  readonly tickCm?: number;
  /**
   * 量程从 0 起还是从最矮的那个起。
   *
   * **缺省从 0 起**：截断纵轴会让 155 与 160 看起来差一倍，这是身高图最经典的
   * 那种「不报错的错」。要截断得显式开，且刻度会照实标出来。
   */
  readonly zeroBased?: boolean;
}

/**
 * 排版。
 *
 * 排序按身高从高到矮，同高时按 ref 的文本序——**必须是全序**，否则同高的两个
 * 角色每次刷新会换位置，看起来像数据在变。
 */
export function layoutChart(
  entries: readonly ChartEntry[],
  options: ChartOptions = {},
): ChartLayout {
  const withHeight: ChartEntry[] = [];
  const missing: ResourceRef[] = [];
  for (const e of entries) {
    if (e.profile.heightCm === null) missing.push(e.ref);
    else withHeight.push(e);
  }

  if (withHeight.length === 0) {
    return { bars: [], ticks: [], maxCm: 0, missing };
  }

  const heights = withHeight.map((e) => e.profile.heightCm as number);
  const maxCm = Math.max(...heights);
  const minCm = Math.min(...heights);
  const base = options.zeroBased === false ? Math.max(0, minCm - 1) : 0;
  const span = maxCm - base;

  const ratioOf = (cm: number): number =>
    // span 为 0 只能是「只有一个角色且量程从它自己起」——那时它就是满格，
    // 不做 0 除（NaN 高度在 DOM 上是「不画」，又是一个不报错的错）。
    span <= 0 ? 1 : (cm - base) / span;

  const bars = withHeight
    .map((e) => ({
      ref: e.ref,
      label: e.profile.name,
      heightCm: e.profile.heightCm as number,
      ratio: ratioOf(e.profile.heightCm as number),
      focus: e.focus,
    }))
    .sort((a, b) => b.heightCm - a.heightCm || formatRef(a.ref).localeCompare(formatRef(b.ref)));

  const tickCm = options.tickCm !== undefined && options.tickCm > 0 ? options.tickCm : 20;
  const ticks: ChartTick[] = [];
  const first = Math.ceil(base / tickCm) * tickCm;
  for (let cm = first; cm <= maxCm; cm += tickCm) {
    ticks.push({ cm, ratio: ratioOf(cm) });
  }

  return { bars, ticks, maxCm, missing };
}
