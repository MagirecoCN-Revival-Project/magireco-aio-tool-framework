import { describe, expect, it } from 'vitest';
import { ArmatureParseError, parseArmature, boneOf } from '../src/armature.js';
import { keyframeAt, matrixOf, worldPoseAt } from '../src/pose.js';

/**
 * 骨架结构与世界变换。数据全部是**合成的**（铁律 9）。
 *
 * 这里验的是「不合成父级会怎样」「显示索引越界会怎样」这类判据——
 * 它们错了都不报错，只是画出另一个样子。
 */

const doc = (bones: unknown[], tracks: unknown[] = [], over: Record<string, unknown> = {}) =>
  parseArmature({
    armature_data: [{ name: 'a', bone_data: bones }],
    animation_data: [{ name: 'a', mov_data: [{ name: 'm', dr: 10, lp: false, sc: 1, mov_bone_data: tracks }] }],
    ...over,
  });

const bone = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  parent: '',
  x: 0,
  y: 0,
  cX: 1,
  cY: 1,
  kX: 0,
  kY: 0,
  z: 0,
  display_data: [{ name: `${name}.png` }],
  ...over,
});

const track = (name: string, frames: Record<string, unknown>[]) => ({
  name,
  frame_data: frames,
});

describe('parseArmature 的骨架结构', () => {
  it('读出父子、基础变换、画序与显示清单', () => {
    const d = doc([
      bone('root', { x: 5, y: 7, z: 2 }),
      bone('hand', { parent: 'root', cX: 2, display_data: [{ name: 'a.png' }, { name: 'b.png' }] }),
    ]);
    expect(d.bones.map((b) => b.name)).toEqual(['root', 'hand']);
    expect(boneOf(d, 'root')).toMatchObject({ parent: null, z: 2, base: { x: 5, y: 7 } });
    expect(boneOf(d, 'hand')).toMatchObject({ parent: 'root', base: { scaleX: 2 } });
    expect(boneOf(d, 'hand')?.displays).toEqual(['a.png', 'b.png']);
    expect(boneOf(d, 'nope')).toBeNull();
  });

  it('非贴图的显示项占位为 null 而不是被过滤掉', () => {
    // 过滤会让它后面每个 dI 都错位一格，于是每根骨骼都画了隔壁的零件。
    const d = doc([bone('b', { display_data: [{ _isArmature: 1 }, { name: 'real.png' }] })]);
    expect(boneOf(d, 'b')?.displays).toEqual([null, 'real.png']);
  });

  it('bone_data 缺失或为空不抛——只是画不了贴图，不该让文件打不开', () => {
    expect(doc([]).bones).toEqual([]);
    expect(
      parseArmature({
        armature_data: [{ name: 'a' }],
        animation_data: [{ name: 'a', mov_data: [{ name: 'm', dr: 1 }] }],
      }).bones,
    ).toEqual([]);
  });

  it('结构自身坏掉要抛：重名、父骨骼不存在、父子成环', () => {
    expect(() => doc([bone('x'), bone('x')])).toThrow(/骨骼名 .* 重复/);
    expect(() => doc([bone('x', { parent: 'ghost' })])).toThrow(/父骨骼 .* 不存在/);
    expect(() => doc([bone('x', { parent: 'y' }), bone('y', { parent: 'x' })])).toThrow(/成环/);
  });

  it('根上的 version 原样读出来——待验证的 combined 分支要用它判', () => {
    expect(doc([]).dataVersion).toBe(0);
    expect(doc([], [], { version: 0.3 }).dataVersion).toBe(0.3);
  });

  it('关键帧带上 dI 与 z，缺省分别是 0 与 null', () => {
    const d = doc([bone('b')], [track('b', [{ fi: 0 }, { fi: 5, dI: 1, z: 9 }])]);
    const keys = d.movements[0]!.tracks[0]!.keyframes;
    expect(keys[0]).toMatchObject({ displayIndex: 0, z: null });
    expect(keys[1]).toMatchObject({ displayIndex: 1, z: 9 });
  });
});

describe('keyframeAt', () => {
  it('取最后一条不晚于本帧的关键帧——显示索引是阶跃的，不能插值', () => {
    // 插出来的 dI 是 1.5，取整之后这一帧画的是隔壁那个零件。
    const d = doc([bone('b')], [track('b', [{ fi: 0, dI: 0 }, { fi: 4, dI: 1 }, { fi: 8, dI: 2 }])]);
    const t = d.movements[0]!.tracks[0]!;
    expect(keyframeAt(t, 0)?.displayIndex).toBe(0);
    expect(keyframeAt(t, 3)?.displayIndex).toBe(0);
    expect(keyframeAt(t, 4)?.displayIndex).toBe(1);
    expect(keyframeAt(t, 100)?.displayIndex).toBe(2);
  });

  it('本帧早于第一条关键帧时取第一条，没有关键帧时返回 null', () => {
    const d = doc([bone('b')], [track('b', [{ fi: 5, dI: 3 }])]);
    expect(keyframeAt(d.movements[0]!.tracks[0]!, 0)?.displayIndex).toBe(3);
    expect(keyframeAt({ name: 'x', keyframes: [] }, 0)).toBeNull();
  });
});

describe('worldPoseAt', () => {
  const at = (d: ReturnType<typeof doc>, frame = 0) => {
    const out = new Map(worldPoseAt(d, d.movements[0]!, frame).map((b) => [b.name, b]));
    return out;
  };

  it('位移经父级矩阵变换后加上父级位移', () => {
    const d = doc([
      bone('root', { x: 10, y: 20 }),
      bone('hand', { parent: 'root', x: 3, y: 4 }),
    ]);
    expect(at(d).get('hand')!.pose).toMatchObject({ x: 13, y: 24 });
  });

  it('父级旋转会把子级的局部位移转过去，不是简单相加', () => {
    // root 转 90°（kX=kY=π/2），子级的 (10,0) 应当落在 (0,10) 上。
    const d = doc([
      bone('root', { kX: Math.PI / 2, kY: Math.PI / 2 }),
      bone('hand', { parent: 'root', x: 10, y: 0 }),
    ]);
    const hand = at(d).get('hand')!.pose;
    expect(hand.x).toBeCloseTo(0, 10);
    expect(hand.y).toBeCloseTo(10, 10);
  });

  it('缩放相乘、斜切相加', () => {
    const d = doc([
      bone('root', { cX: 2, cY: 3, kX: 0.1, kY: 0.2 }),
      bone('hand', { parent: 'root', cX: 5, cY: 7, kX: 0.01, kY: 0.02 }),
    ]);
    const hand = at(d).get('hand')!.pose;
    expect(hand.scaleX).toBe(10);
    expect(hand.scaleY).toBe(21);
    expect(hand.skewX).toBeCloseTo(0.11, 10);
    expect(hand.skewY).toBeCloseTo(0.22, 10);
  });

  it('没有轨道的骨骼停在 base 上，但照样参与合成', () => {
    // 漏掉它，挂在它下面的子骨骼会被摆到错误的绝对位置。
    const d = doc(
      [bone('root', { x: 100 }), bone('hand', { parent: 'root' })],
      [track('hand', [{ fi: 0, x: 1 }])],
    );
    expect(at(d).get('root')!.pose.x).toBe(100);
    expect(at(d).get('hand')!.pose.x).toBe(101);
  });

  it('只在动画里出现、结构里没有的骨骼：局部即世界，display 为 null', () => {
    const d = doc([], [track('ghost', [{ fi: 0, x: 5 }])]);
    const g = at(d).get('ghost')!;
    expect(g.pose.x).toBe(5);
    expect(g.display).toBeNull();
  });

  it('按 dI 选零件；越界与负数一律不显示，不回退到第 0 个', () => {
    // 回退等于这一帧画了另一个零件，而且不报错。
    const d = doc(
      [bone('b', { display_data: [{ name: 'a.png' }, { name: 'b.png' }] })],
      [track('b', [{ fi: 0, dI: 1 }, { fi: 2, dI: 9 }, { fi: 4, dI: -1 }])],
    );
    expect(at(d, 0).get('b')!.display).toBe('b.png');
    expect(at(d, 2).get('b')!.display).toBeNull();
    expect(at(d, 4).get('b')!.display).toBeNull();
  });

  it('按画序排；每帧的 z 优先于骨骼自身的 z', () => {
    const d = doc(
      [bone('back', { z: 5 }), bone('front', { z: 1 })],
      [track('front', [{ fi: 0 }, { fi: 5, z: 99 }])],
    );
    expect(worldPoseAt(d, d.movements[0]!, 0).map((b) => b.name)).toEqual(['front', 'back']);
    // 第 5 帧 front 的 z 变成 99，跑到 back 后面去。
    expect(worldPoseAt(d, d.movements[0]!, 5).map((b) => b.name)).toEqual(['back', 'front']);
  });

  it('z 相同时保持声明顺序——否则两次渲染的遮挡关系会不一样', () => {
    const d = doc([bone('a'), bone('b'), bone('c')]);
    expect(worldPoseAt(d, d.movements[0]!, 0).map((x) => x.name)).toEqual(['a', 'b', 'c']);
  });
});

describe('matrixOf', () => {
  it('单位姿态是单位矩阵', () => {
    expect(matrixOf({ x: 0, y: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 })).toEqual({
      a: 1,
      b: 0,
      c: -0,
      d: 1,
      tx: 0,
      ty: 0,
    });
  });

  it('纯旋转（skewX === skewY）是一个正交矩阵', () => {
    const m = matrixOf({ x: 0, y: 0, scaleX: 1, scaleY: 1, skewX: 0.7, skewY: 0.7 });
    expect(m.a * m.c + m.b * m.d).toBeCloseTo(0, 10);
    expect(m.a * m.a + m.b * m.b).toBeCloseTo(1, 10);
  });
});
