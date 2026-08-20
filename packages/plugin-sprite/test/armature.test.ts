import { describe, expect, it } from 'vitest';
import { ArmatureParseError, movementOf, parseArmature } from '../src/armature.js';

/**
 * 骨骼数据全部是**合成的**，不是游戏素材（铁律 9）。
 * 这里验的是格式判据，与素材内容无关。
 */

const doc = (movs: unknown[], extra: Record<string, unknown> = {}) => ({
  armature_data: [{ name: 'mini_000000', bone_data: [] }],
  animation_data: [{ name: 'mini_000000', mov_data: movs }],
  texture_data: [{ name: 'part_a', width: 10, height: 10, plistFile: 'x.plist' }],
  ...extra,
});

const mov = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  dr: 30,
  lp: false,
  sc: 1,
  mov_bone_data: [{ name: 'bone_a', frame_data: [] }],
  ...over,
});

describe('parseArmature', () => {
  it('把动作清单读出来——名字来自数据，不是按规律推的', () => {
    const d = parseArmature(doc([mov('name_r'), mov('action_in', { lp: true, dr: 12, sc: 2 })]));
    expect(d.armature).toBe('mini_000000');
    expect(d.movements.map((m) => m.name)).toEqual(['name_r', 'action_in']);
    expect(d.movements[1]).toMatchObject({ frames: 12, loop: true, speedScale: 2 });
    expect(d.movements[0]?.bones).toEqual(['bone_a']);
  });

  it('收集图集分片', () => {
    const d = parseArmature(doc([mov('a')]));
    expect(d.textures).toEqual([{ name: 'part_a', plistFile: 'x.plist' }]);
  });

  it('dr 不是正数直接抛——不给它编一个默认帧长', () => {
    for (const bad of [0, -1, 'x', undefined, Number.NaN]) {
      expect(() => parseArmature(doc([mov('a', { dr: bad })]))).toThrow(ArmatureParseError);
    }
    expect(() => parseArmature(doc([mov('a', { dr: 0 })]))).toThrow(/帧长/);
  });

  it('动作重名直接抛——否则「按名字选动作」变成看运气', () => {
    expect(() => parseArmature(doc([mov('same'), mov('same')]))).toThrow(/重复/);
  });

  it('sc 缺失或非法时退回 1，而不是让速度变成 0 或负数', () => {
    for (const bad of [undefined, 0, -2, 'x']) {
      const d = parseArmature(doc([mov('a', { sc: bad })]));
      expect(d.movements[0]?.speedScale).toBe(1);
    }
  });

  it('结构不对一律抛，不做宽松模式', () => {
    expect(() => parseArmature(null)).toThrow(/不是对象/);
    expect(() => parseArmature({})).toThrow(/armature_data/);
    expect(() => parseArmature({ armature_data: [] })).toThrow(/空的/);
    expect(() => parseArmature({ armature_data: [{}], animation_data: [] })).toThrow(/缺 name/);
    expect(() => parseArmature(doc([]))).toThrow(/一个动作都没解析出来/);
    expect(() => parseArmature(doc([{ dr: 5 }]))).toThrow(/缺 name/);
  });
});

describe('movementOf', () => {
  it('查不到返回 null，绝不退回第一个', () => {
    const d = parseArmature(doc([mov('name_r'), mov('action_out')]));
    expect(movementOf(d, 'action_out')?.name).toBe('action_out');
    // 退回第一个的话，点「action_out」会播出「name_r」，看着能用其实是别的动作。
    expect(movementOf(d, '不存在')).toBeNull();
  });
});
