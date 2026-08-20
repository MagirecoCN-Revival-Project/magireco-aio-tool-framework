import { describe, expect, it, vi } from 'vitest';
import { parseArmature, type SpriteDoc } from '../src/armature.js';
import { SpritePlayer, SpritePlayerError, type Stage } from '../src/player.js';

function docOf(movs: { name: string; dr: number; lp?: boolean; sc?: number }[]): SpriteDoc {
  return parseArmature({
    armature_data: [{ name: 'mini_000000', bone_data: [] }],
    animation_data: [
      {
        name: 'mini_000000',
        mov_data: movs.map((m) => ({
          name: m.name,
          dr: m.dr,
          lp: m.lp ?? false,
          sc: m.sc ?? 1,
          mov_bone_data: [],
        })),
      },
    ],
    texture_data: [],
  });
}

function recordingStage(): Stage & { frames: number[]; disposed: number } {
  const frames: number[] = [];
  let disposed = 0;
  return {
    frames,
    get disposed() {
      return disposed;
    },
    drawFrame(_m, f) {
      frames.push(f);
    },
    dispose() {
      disposed += 1;
    },
  };
}

describe('SpritePlayer', () => {
  it('动作列表来自数据', () => {
    const p = new SpritePlayer({ doc: docOf([{ name: 'a', dr: 3 }, { name: 'b', dr: 3 }]), autoPlay: false });
    expect(p.list()).toEqual(['a', 'b']);
    expect(p.movement.name).toBe('a');
  });

  it('选不存在的动作抛错并列出可选值，不退回第一个', () => {
    const p = new SpritePlayer({ doc: docOf([{ name: 'a', dr: 3 }]), autoPlay: false });
    expect(() => p.select('没有这个')).toThrow(SpritePlayerError);
    expect(() => p.select('没有这个')).toThrow(/这份骨骼里有：a/);
    expect(p.movement.name).toBe('a');
  });

  it('不循环的动作播完停住，而不是回到第 0 帧', () => {
    vi.useFakeTimers();
    try {
      const p = new SpritePlayer({ doc: docOf([{ name: 'a', dr: 4 }]), fps: 100 });
      vi.advanceTimersByTime(1000);
      expect(p.frame).toBe(3);
      expect(p.paused).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('循环的动作会绕回去', () => {
    vi.useFakeTimers();
    try {
      const p = new SpritePlayer({ doc: docOf([{ name: 'a', dr: 3, lp: true }]), fps: 100 });
      vi.advanceTimersByTime(1000);
      expect(p.paused).toBe(false);
      expect(p.frame).toBeGreaterThanOrEqual(0);
      expect(p.frame).toBeLessThan(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('seek 越界夹到范围内', () => {
    const p = new SpritePlayer({ doc: docOf([{ name: 'a', dr: 5 }]), autoPlay: false });
    p.seek(99);
    expect(p.frame).toBe(4);
    p.seek(-9);
    expect(p.frame).toBe(0);
  });

  it('换动作时帧号归零并回报', () => {
    const onFrame = vi.fn();
    const p = new SpritePlayer({
      doc: docOf([{ name: 'a', dr: 5 }, { name: 'b', dr: 9 }]),
      autoPlay: false,
      onFrame,
    });
    p.seek(3);
    p.select('b');
    expect(p.frame).toBe(0);
    expect(onFrame).toHaveBeenLastCalledWith(0, 9, expect.objectContaining({ name: 'b' }));
  });

  it('dispose 幂等，清定时器并释放舞台；之后不再回话', () => {
    vi.useFakeTimers();
    try {
      const stage = recordingStage();
      const onFrame = vi.fn();
      const p = new SpritePlayer({ doc: docOf([{ name: 'a', dr: 999, lp: true }]), stage, fps: 100, onFrame });
      vi.advanceTimersByTime(100);

      p.dispose();
      const calls = onFrame.mock.calls.length;
      vi.advanceTimersByTime(10_000);
      expect(onFrame.mock.calls.length).toBe(calls);
      expect(stage.disposed).toBe(1);

      p.dispose();
      expect(stage.disposed).toBe(1);
      expect(p.disposed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('没有舞台也照常推帧——渲染是可选的，契约行为不是', () => {
    const onFrame = vi.fn();
    const p = new SpritePlayer({ doc: docOf([{ name: 'a', dr: 5 }]), stage: null, autoPlay: false, onFrame });
    p.seek(2);
    expect(onFrame).toHaveBeenCalledWith(2, 5, expect.objectContaining({ name: 'a' }));
  });
});
