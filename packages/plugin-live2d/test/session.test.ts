import { describe, expect, it, vi } from 'vitest';
import { parseModel3, type Live2dDoc } from '../src/model3.js';
import { Live2dSession, Live2dSessionError, type Stage } from '../src/session.js';

function build(over: Record<string, unknown> = {}): Live2dDoc {
  return parseModel3({
    Name: '合成模型',
    FileReferences: {
      Moc: 'm.moc3',
      Textures: ['t.png'],
      Motions: { idle: [{ File: 'idle.json' }], tap: [{ File: 'tap.json' }] },
      Expressions: [{ Name: 'ex_01', File: 'ex_01.json' }],
    },
    Groups: [{ Target: 'Parameter', Name: 'LipSync', Ids: ['ParamMouthOpenY'] }],
    ...over,
  });
}

function spyStage(): Stage & { motions: string[]; exprs: (string | null)[]; lip: boolean[] } {
  const motions: string[] = [];
  const exprs: (string | null)[] = [];
  const lip: boolean[] = [];
  return {
    motions,
    exprs,
    lip,
    playMotion: (m) => motions.push(m.file),
    setExpression: (f) => exprs.push(f),
    setLipSync: (e) => lip.push(e),
    dispose: vi.fn(),
  };
}

describe('Live2dSession', () => {
  it('动作组与表情列表来自数据', () => {
    const s = new Live2dSession({ doc: build() });
    expect(s.groups()).toEqual(['idle', 'tap']);
    expect(s.expressions()).toEqual(['ex_01']);
  });

  it('选不存在的动作抛错并列出可选值', () => {
    const s = new Live2dSession({ doc: build() });
    expect(() => s.setMotion('没有这个')).toThrow(Live2dSessionError);
    expect(() => s.setMotion('没有这个')).toThrow(/这个模型有：idle、tap/);
  });

  it('选不存在的表情抛错', () => {
    const s = new Live2dSession({ doc: build() });
    expect(() => s.setExpression('没有这个')).toThrow(/没有表情/);
  });

  it('选中的动作与表情交给舞台', () => {
    const stage = spyStage();
    const s = new Live2dSession({ doc: build(), stage, motion: 'tap', expression: 'ex_01' });
    expect(stage.motions).toEqual(['tap.json']);
    expect(stage.exprs).toEqual(['ex_01.json']);
    expect(s.motion?.group).toBe('tap');
  });

  it('表情传 null 表示清掉', () => {
    const stage = spyStage();
    const s = new Live2dSession({ doc: build(), stage, expression: 'ex_01' });
    s.setExpression(null);
    expect(s.expression).toBeNull();
    expect(stage.exprs).toEqual(['ex_01.json', null]);
  });

  it('模型没登记 LipSync 时开不起来，且明确返回 false', () => {
    const s = new Live2dSession({ doc: build({ Groups: [] }) });
    expect(s.supportsLipSync).toBe(false);
    // 静默忽略的话，调用方会以为开了却没动静。
    expect(s.setLipSync(true)).toBe(false);
    expect(s.lipSyncEnabled).toBe(false);
  });

  it('支持时开得起来', () => {
    const stage = spyStage();
    const s = new Live2dSession({ doc: build(), stage });
    expect(s.setLipSync(true)).toBe(true);
    expect(s.lipSyncEnabled).toBe(true);
    expect(stage.lip).toEqual([true]);
  });

  it('dispose 幂等，释放舞台，之后所有操作变成空转', () => {
    const stage = spyStage();
    const s = new Live2dSession({ doc: build(), stage });
    s.dispose();
    s.dispose();
    expect(stage.dispose).toHaveBeenCalledTimes(1);

    const before = stage.motions.length;
    s.setMotion('idle');
    expect(stage.motions.length).toBe(before);
    expect(s.setLipSync(true)).toBe(false);
    expect(s.disposed).toBe(true);
  });

  it('没有舞台也照常维护状态——渲染是可选的，契约行为不是', () => {
    const s = new Live2dSession({ doc: build(), stage: null, motion: 'idle' });
    expect(s.motion?.file).toBe('idle.json');
  });
});
