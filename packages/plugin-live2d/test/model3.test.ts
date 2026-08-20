import { describe, expect, it } from 'vitest';
import { Model3ParseError, motionGroups, motionOf, parseModel3 } from '../src/model3.js';

/**
 * 数据是**合成的**，但形状取自真实模型描述文件实测——特别是
 * `Physics` / `DisplayInfo` 为 **null 而不是缺键**这一点。
 */

interface Over {
  FileReferences?: Record<string, unknown>;
  Groups?: unknown;
}

// 注意：FileReferences 要**并进去**而不是整个替换掉，否则一个只想改 Textures
// 的用例会连 Moc 一起丢掉——这个辅助函数最初就是这么写错的，四条用例齐红。
const doc = ({ FileReferences: fr, ...rest }: Over = {}) => ({
  Version: 3,
  Name: '合成模型',
  FileReferences: {
    Moc: 'm.moc3',
    Textures: ['textures/texture_00.png'],
    Physics: null,
    Pose: 'm.pose3.json',
    DisplayInfo: null,
    Motions: {
      motion_000: [{ File: 'motions/motion_000.motion3.json' }],
      motion_100: [{ File: 'motions/a.motion3.json' }, { File: 'motions/b.motion3.json' }],
    },
    Expressions: [{ Name: 'ex_01', File: 'expressions/ex_01.exp3.json' }],
    ...fr,
  },
  Groups: [
    { Target: 'Parameter', Name: 'EyeBlink', Ids: ['ParamEyeLOpen', 'ParamEyeROpen'] },
    { Target: 'Parameter', Name: 'LipSync', Ids: ['ParamMouthOpenY'] },
  ],
  ...rest,
});

describe('parseModel3', () => {
  it('把清单读出来，null 字段当「没有」而不是崩', () => {
    const d = parseModel3(doc());
    expect(d.moc).toBe('m.moc3');
    expect(d.textures).toEqual(['textures/texture_00.png']);
    // 实测里这两个就是 null——只判断 'Physics' in refs 会得到 true，
    // 然后拿着 null 当路径用。
    expect(d.physics).toBeNull();
    expect(d.displayInfo).toBeNull();
    expect(d.pose).toBe('m.pose3.json');
  });

  it('动作按组展开，同组多条各有下标', () => {
    const d = parseModel3(doc());
    expect(motionGroups(d)).toEqual(['motion_000', 'motion_100']);
    expect(d.motions).toHaveLength(3);
    expect(motionOf(d, 'motion_100', 1)?.file).toBe('motions/b.motion3.json');
  });

  it('读出眨眼与口型同步参数——空数组表示这个模型不支持', () => {
    const d = parseModel3(doc());
    expect(d.eyeBlink).toEqual(['ParamEyeLOpen', 'ParamEyeROpen']);
    expect(d.lipSync).toEqual(['ParamMouthOpenY']);
    expect(parseModel3(doc({ Groups: [] })).lipSync).toEqual([]);
  });

  it('缺 Moc 直接抛——没有它什么都画不出来', () => {
    expect(() => parseModel3(doc({ FileReferences: { Moc: null } }))).toThrow(Model3ParseError);
    expect(() => parseModel3(doc({ FileReferences: { Moc: null } }))).toThrow(/Moc/);
  });

  it('贴图为空直接抛——缺贴图不会白屏，会画成一团纯色', () => {
    expect(() => parseModel3(doc({ FileReferences: { Textures: [] } }))).toThrow(/Textures/);
    expect(() => parseModel3(doc({ FileReferences: { Textures: 'x' } }))).toThrow(/不是数组/);
  });

  it('动作条目缺 File 直接抛，不静默丢掉', () => {
    expect(() =>
      parseModel3(doc({ FileReferences: { Motions: { g: [{}] } } })),
    ).toThrow(/缺 File/);
  });

  it('表情缺 Name 或 File 直接抛', () => {
    expect(() =>
      parseModel3(doc({ FileReferences: { Expressions: [{ Name: 'x' }] } })),
    ).toThrow(/缺 Name 或 File/);
  });

  it('没有 Motions 也能解析——那只是个没有动作的模型', () => {
    const d = parseModel3(doc({ FileReferences: { Motions: null } }));
    expect(d.motions).toEqual([]);
    expect(motionGroups(d)).toEqual([]);
  });

  it('结构不对一律抛', () => {
    expect(() => parseModel3(null)).toThrow(/不是对象/);
    expect(() => parseModel3({})).toThrow(/FileReferences/);
  });
});

describe('motionOf', () => {
  it('查不到返回 null，绝不退回第一条', () => {
    const d = parseModel3(doc());
    // 退回第一条的话，点 motion_100 会播 motion_000。
    expect(motionOf(d, '不存在')).toBeNull();
    expect(motionOf(d, 'motion_000', 5)).toBeNull();
  });
});
