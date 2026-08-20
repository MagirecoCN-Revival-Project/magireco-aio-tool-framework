import { describe, expect, it, vi } from 'vitest';
import { AdvEngine, type Stage } from '../src/engine.js';
import { parseWorksheet, type ScenarioCommand, type ScenarioDoc } from '../src/scenario.js';

function doc(n: number): ScenarioDoc {
  return parseWorksheet({
    sheetList: [
      {
        headerRow: { cellList: ['ActionType', 'Comment', 'AssetID'] },
        contentRowList: Array.from({ length: n }, (_, i) => ({
          cellList: ['Talk', `第 ${i} 句`, i === 2 ? 'asset-2' : ''],
        })),
      },
    ],
  });
}

function recordingStage(): Stage & { shown: ScenarioCommand[]; disposed: number } {
  const shown: ScenarioCommand[] = [];
  let disposed = 0;
  return {
    shown,
    get disposed() {
      return disposed;
    },
    show(c) {
      shown.push(c);
    },
    dispose() {
      disposed += 1;
    },
  };
}

describe('AdvEngine', () => {
  it('seek 越界夹到范围内，不抛——一个坏行号不该让播放器整个挂掉', () => {
    const e = new AdvEngine({ doc: doc(5) });
    e.seek(99);
    expect(e.position).toBe(4);
    e.seek(-3);
    expect(e.position).toBe(0);
    e.seek(Number.NaN);
    expect(e.position).toBe(0);
  });

  it('每次定位都回报进度', () => {
    const onProgress = vi.fn();
    const e = new AdvEngine({ doc: doc(4), onProgress });
    e.seek(2);
    expect(onProgress).toHaveBeenLastCalledWith(2, 4);
  });

  it('指令带 assetId 时回报，供「点立绘打开档案」', () => {
    const onAsset = vi.fn();
    const e = new AdvEngine({ doc: doc(4), onAsset });
    e.seek(1);
    expect(onAsset).not.toHaveBeenCalled();
    e.seek(2);
    expect(onAsset).toHaveBeenCalledWith('asset-2', expect.objectContaining({ index: 2 }));
  });

  it('自动推进，播到底停住而不循环——循环会让「播完了」无法观察', () => {
    vi.useFakeTimers();
    try {
      const e = new AdvEngine({ doc: doc(3), autoAdvanceMs: 100 });
      e.play();
      vi.advanceTimersByTime(1000);
      expect(e.position).toBe(2);
      expect(e.paused).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pause 之后不再自动推进', () => {
    vi.useFakeTimers();
    try {
      const e = new AdvEngine({ doc: doc(50), autoAdvanceMs: 100 });
      e.play();
      vi.advanceTimersByTime(300);
      const at = e.position;
      e.pause();
      vi.advanceTimersByTime(1000);
      expect(e.position).toBe(at);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispose 幂等，清掉定时器并释放舞台', () => {
    vi.useFakeTimers();
    try {
      const stage = recordingStage();
      const onProgress = vi.fn();
      const e = new AdvEngine({ doc: doc(50), stage, autoAdvanceMs: 100, onProgress });
      e.play();
      vi.advanceTimersByTime(200);

      e.dispose();
      const calls = onProgress.mock.calls.length;
      vi.advanceTimersByTime(10_000);
      // 关闭之后不能再有任何回话——这正是一致性套件那条判据要抓的泄漏。
      expect(onProgress.mock.calls.length).toBe(calls);
      expect(stage.disposed).toBe(1);

      e.dispose();
      expect(stage.disposed).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispose 之后 seek/play 都是空操作', () => {
    const onProgress = vi.fn();
    const e = new AdvEngine({ doc: doc(5), onProgress });
    e.dispose();
    e.seek(3);
    e.play();
    expect(onProgress).not.toHaveBeenCalled();
    expect(e.disposed).toBe(true);
  });

  it('没有舞台也照常跑时间轴——渲染是可选的，契约行为不是', () => {
    const onProgress = vi.fn();
    const e = new AdvEngine({ doc: doc(3), stage: null, onProgress });
    e.seek(1);
    expect(onProgress).toHaveBeenCalledWith(1, 3);
  });

  it('有舞台时把指令交给它', () => {
    const stage = recordingStage();
    const e = new AdvEngine({ doc: doc(3), stage });
    e.seek(1);
    expect(stage.shown.at(-1)?.index).toBe(1);
  });
});
